import base64

import pytest
from fastapi import HTTPException

from backend.models.xacro import XacroExpandRequest, XacroFile
from backend.services.xacro import expand_xacro


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _b64_bytes(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def test_expand_xacro_cross_package_find_without_ros_runtime() -> None:
    main_xacro = """<?xml version="1.0"?>
<robot name="demo" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="$(find pkg_b)/urdf/shared.xacro"/>
  <link name="base"/>
  <xacro:shared_link/>
</robot>
"""
    shared_xacro = """<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:macro name="shared_link" params="">
    <link name="shared"/>
  </xacro:macro>
</robot>
"""
    request = XacroExpandRequest(
        target_path="pkg_a/urdf/main.xacro",
        files=[
            XacroFile(path="pkg_a/package.xml", content_base64=_b64("<package><name>pkg_a</name></package>")),
            XacroFile(path="pkg_b/package.xml", content_base64=_b64("<package><name>pkg_b</name></package>")),
            XacroFile(path="pkg_a/urdf/main.xacro", content_base64=_b64(main_xacro)),
            XacroFile(path="pkg_b/urdf/shared.xacro", content_base64=_b64(shared_xacro)),
        ],
        args={},
        use_inorder=True,
    )

    urdf, stderr = expand_xacro(request)
    assert stderr is None or isinstance(stderr, str)
    assert 'link name="base"' in urdf
    assert 'link name="shared"' in urdf


def test_expand_xacro_missing_package_reports_clear_error() -> None:
    main_xacro = """<?xml version="1.0"?>
<robot name="demo" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="$(find missing_pkg)/urdf/part.xacro"/>
</robot>
"""
    request = XacroExpandRequest(
        target_path="pkg_a/urdf/main.xacro",
        files=[
            XacroFile(path="pkg_a/package.xml", content_base64=_b64("<package><name>pkg_a</name></package>")),
            XacroFile(path="pkg_a/urdf/main.xacro", content_base64=_b64(main_xacro)),
        ],
        args={},
        use_inorder=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        expand_xacro(request)
    assert exc_info.value.status_code == 400
    assert "missing_pkg" in str(exc_info.value.detail)


def test_expand_xacro_latin1_support_files_are_normalized_to_utf8() -> None:
    main_xacro_latin1 = """<?xml version="1.0"?>
<robot name="demo" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="$(find pkg_a)/urdf/part.trans"/>
  <!-- café -->
  <xacro:part_link/>
</robot>
""".encode("latin-1")
    trans_latin1 = """<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <!-- pièce -->
  <xacro:macro name="part_link" params="">
    <link name="latin_part"/>
  </xacro:macro>
</robot>
""".encode("latin-1")
    request = XacroExpandRequest(
        target_path="pkg_a/urdf/main.xacro",
        files=[
            XacroFile(path="pkg_a/package.xml", content_base64=_b64("<package><name>pkg_a</name></package>")),
            XacroFile(path="pkg_a/urdf/main.xacro", content_base64=_b64_bytes(main_xacro_latin1)),
            XacroFile(path="pkg_a/urdf/part.trans", content_base64=_b64_bytes(trans_latin1)),
        ],
        args={},
        use_inorder=True,
    )

    urdf, stderr = expand_xacro(request)
    assert stderr is None or isinstance(stderr, str)
    assert 'link name="latin_part"' in urdf
