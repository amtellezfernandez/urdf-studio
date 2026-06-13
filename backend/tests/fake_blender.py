from __future__ import annotations

import types
from pathlib import Path


class _FakeQuaternion:
    def __init__(self, values):
        self.w = float(values[0])
        self.x = float(values[1])
        self.y = float(values[2])
        self.z = float(values[3])


class _FakeMaterialInput:
    default_value = None


class _FakeMaterial:
    def __init__(self, name: str):
        self.name = name
        self.diffuse_color = (1.0, 1.0, 1.0, 1.0)
        self.use_nodes = False
        self.blend_method = "OPAQUE"
        self.node_tree = types.SimpleNamespace(
            nodes={
                "Principled BSDF": types.SimpleNamespace(
                    inputs={
                        "Base Color": _FakeMaterialInput(),
                        "Alpha": _FakeMaterialInput(),
                    }
                )
            }
        )


class _FakeObject(dict):
    def __init__(self, name: str, object_type: str, location=(0.0, 0.0, 0.0)):
        super().__init__()
        self.name = name
        self.type = object_type
        self.location = list(location)
        self.rotation_mode = "QUATERNION"
        self._rotation_quaternion = _FakeQuaternion((1.0, 0.0, 0.0, 0.0))
        self.scale = [1.0, 1.0, 1.0]
        self.color = (1.0, 1.0, 1.0, 1.0)
        self.data = types.SimpleNamespace(materials=[])
        self.parent = None
        self.hide_select = False
        self.lock_location = (False, False, False)
        self.lock_rotation = (False, False, False)
        self.lock_scale = (False, False, False)
        self.bound_box = [
            (-0.5, -0.5, -0.5),
            (-0.5, -0.5, 0.5),
            (-0.5, 0.5, -0.5),
            (-0.5, 0.5, 0.5),
            (0.5, -0.5, -0.5),
            (0.5, -0.5, 0.5),
            (0.5, 0.5, -0.5),
            (0.5, 0.5, 0.5),
        ]
        if object_type == "CAMERA":
            self.data = types.SimpleNamespace(
                angle=0.0,
                clip_start=0.0,
                clip_end=0.0,
                display_size=0.0,
            )
            self.bound_box = None
        elif object_type == "LIGHT":
            self.data = types.SimpleNamespace(energy=0.0, size=0.0)
            self.bound_box = None

    def __hash__(self) -> int:
        return id(self)

    @property
    def rotation_quaternion(self):
        return self._rotation_quaternion

    @rotation_quaternion.setter
    def rotation_quaternion(self, value):
        self._rotation_quaternion = (
            value if isinstance(value, _FakeQuaternion) else _FakeQuaternion(value)
        )

    @property
    def dimensions(self):
        return list(self.scale)


class FakeBlenderModule(types.ModuleType):
    _PNG_1X1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe"
        b"\x02\xfeA\xe2%\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    def __init__(self):
        super().__init__("bpy")
        self.context = types.SimpleNamespace(
            scene=types.SimpleNamespace(
                unit_settings=types.SimpleNamespace(system="", scale_length=1.0),
                render=types.SimpleNamespace(
                    engine="",
                    image_settings=types.SimpleNamespace(file_format=""),
                    resolution_percentage=100,
                    resolution_x=0,
                    resolution_y=0,
                    filepath="",
                ),
                world=types.SimpleNamespace(color=(0.0, 0.0, 0.0)),
                camera=None,
            ),
            object=None,
        )
        self.data = types.SimpleNamespace(
            objects=[],
            materials=types.SimpleNamespace(new=self._new_material),
            texts=types.SimpleNamespace(new=self._new_text),
        )
        self.ops = types.SimpleNamespace(
            object=types.SimpleNamespace(
                select_all=lambda **_kwargs: None,
                delete=self._delete_objects,
                light_add=self._add_light,
                camera_add=self._add_camera,
                empty_add=self._add_empty,
            ),
            mesh=types.SimpleNamespace(
                primitive_uv_sphere_add=self._add_mesh,
                primitive_cylinder_add=self._add_mesh,
                primitive_cube_add=self._add_mesh,
            ),
            render=types.SimpleNamespace(render=self._render),
            wm=types.SimpleNamespace(
                save_as_mainfile=self._save_as_mainfile,
                obj_import=self._import_mesh_file,
                stl_import=self._import_mesh_file,
                ply_import=self._import_mesh_file,
                collada_import=self._import_mesh_file,
                usd_import=self._import_mesh_file,
            ),
            import_scene=types.SimpleNamespace(
                gltf=self._import_mesh_file,
                obj=self._import_mesh_file,
            ),
            import_mesh=types.SimpleNamespace(
                stl=self._import_mesh_file,
                ply=self._import_mesh_file,
            ),
        )

    def _new_material(self, name: str):
        return _FakeMaterial(name)

    def _new_text(self, name: str):
        text = types.SimpleNamespace(name=name, body="")
        text.write = lambda value: setattr(text, "body", text.body + value)
        return text

    def _append_object(self, obj: _FakeObject):
        self.data.objects.append(obj)
        self.context.object = obj
        return obj

    def _delete_objects(self):
        self.data.objects.clear()
        self.context.object = None

    def _add_light(self, *, type: str, location):  # noqa: A002 - matches Blender API.
        return self._append_object(_FakeObject(f"{type.lower()}_light", "LIGHT", location))

    def _add_camera(self, *, location):
        return self._append_object(_FakeObject("camera", "CAMERA", location))

    def _add_empty(self, *, type: str, location):  # noqa: A002 - matches Blender API.
        return self._append_object(_FakeObject(f"{type.lower()}_empty", "EMPTY", location))

    def _add_mesh(self, **kwargs):
        location = kwargs.get("location", (0.0, 0.0, 0.0))
        return self._append_object(_FakeObject("mesh", "MESH", location))

    def _import_mesh_file(self, *, filepath: str):
        obj = _FakeObject(Path(filepath).stem or "imported_mesh", "MESH")
        obj["fake_import_path"] = filepath
        return self._append_object(obj)

    def _render(self, *, write_still: bool):
        assert write_still is True
        path = Path(self.context.scene.render.filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self._PNG_1X1)

    def _save_as_mainfile(self, *, filepath: str):
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fake blender file\n", encoding="utf-8")
