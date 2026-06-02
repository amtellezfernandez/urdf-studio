from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class IluAssemblyBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class IluAssemblyManifestFile(IluAssemblyBaseModel):
    path: str = Field(..., min_length=1)
    url: str = Field(..., min_length=1)
    mime: str | None = Field(default=None)


class IluAssemblySource(IluAssemblyBaseModel):
    type: Literal["local"]
    folder: str | None = Field(default=None)


class IluAssemblyManifestResponse(IluAssemblyBaseModel):
    label: str | None = Field(default=None)
    files: list[IluAssemblyManifestFile] = Field(..., min_length=1)
    selected_paths: list[str] = Field(
        ...,
        min_length=1,
        serialization_alias="selectedPaths",
        validation_alias=AliasChoices("selectedPaths", "selected_paths"),
    )
    names_by_path: dict[str, str] = Field(
        default_factory=dict,
        serialization_alias="namesByPath",
        validation_alias=AliasChoices("namesByPath", "names_by_path"),
    )
    source_by_path: dict[str, IluAssemblySource] = Field(
        default_factory=dict,
        serialization_alias="sourceByPath",
        validation_alias=AliasChoices("sourceByPath", "source_by_path"),
    )
