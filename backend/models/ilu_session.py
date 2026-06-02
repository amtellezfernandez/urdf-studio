from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class IluSessionBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class IluSessionLoadedSource(IluSessionBaseModel):
    source: Literal["local-file", "local-repo", "github"]
    urdf_path: str = Field(
        ...,
        min_length=1,
        serialization_alias="urdfPath",
        validation_alias=AliasChoices("urdfPath", "urdf_path"),
    )
    local_path: str | None = Field(
        default=None,
        serialization_alias="localPath",
        validation_alias=AliasChoices("localPath", "local_path"),
    )
    github_ref: str | None = Field(
        default=None,
        serialization_alias="githubRef",
        validation_alias=AliasChoices("githubRef", "github_ref"),
    )
    github_revision: str | None = Field(
        default=None,
        serialization_alias="githubRevision",
        validation_alias=AliasChoices("githubRevision", "github_revision"),
    )
    repository_urdf_path: str | None = Field(
        default=None,
        serialization_alias="repositoryUrdfPath",
        validation_alias=AliasChoices("repositoryUrdfPath", "repository_urdf_path"),
    )


class IluSessionSnapshotResponse(IluSessionBaseModel):
    session_schema: Literal["ilu-shared-session"] = Field(
        ...,
        serialization_alias="schema",
        validation_alias=AliasChoices("schema", "session_schema"),
    )
    schema_version: int = Field(
        ...,
        ge=1,
        serialization_alias="schemaVersion",
        validation_alias=AliasChoices("schemaVersion", "schema_version"),
    )
    session_id: str = Field(
        ...,
        min_length=1,
        serialization_alias="sessionId",
        validation_alias=AliasChoices("sessionId", "session_id"),
    )
    created_at: str = Field(
        ...,
        serialization_alias="createdAt",
        validation_alias=AliasChoices("createdAt", "created_at"),
    )
    updated_at: str = Field(
        ...,
        serialization_alias="updatedAt",
        validation_alias=AliasChoices("updatedAt", "updated_at"),
    )
    working_urdf_path: str = Field(
        ...,
        min_length=1,
        serialization_alias="workingUrdfPath",
        validation_alias=AliasChoices("workingUrdfPath", "working_urdf_path"),
    )
    last_urdf_path: str = Field(
        ...,
        min_length=1,
        serialization_alias="lastUrdfPath",
        validation_alias=AliasChoices("lastUrdfPath", "last_urdf_path"),
    )
    urdf_xml: str = Field(
        ...,
        serialization_alias="urdfContent",
        validation_alias=AliasChoices("urdfContent", "urdf_xml"),
    )
    loaded_source: IluSessionLoadedSource | None = Field(
        default=None,
        serialization_alias="loadedSource",
        validation_alias=AliasChoices("loadedSource", "loaded_source"),
    )


class IluSessionAssetManifestFile(IluSessionBaseModel):
    path: str = Field(..., min_length=1)
    url: str = Field(..., min_length=1)
    mime: str | None = Field(default=None)


class IluSessionAssetManifestResponse(IluSessionBaseModel):
    label: str | None = Field(default=None)
    files: list[IluSessionAssetManifestFile] = Field(..., min_length=1)


class IluSessionSaveRequest(IluSessionBaseModel):
    urdf_xml: str = Field(
        ...,
        serialization_alias="urdfContent",
        validation_alias=AliasChoices("urdfContent", "urdf_xml"),
    )


class IluSessionSaveResponse(IluSessionBaseModel):
    session_id: str = Field(
        ...,
        min_length=1,
        serialization_alias="sessionId",
        validation_alias=AliasChoices("sessionId", "session_id"),
    )
    updated_at: str = Field(
        ...,
        serialization_alias="updatedAt",
        validation_alias=AliasChoices("updatedAt", "updated_at"),
    )
    working_urdf_path: str = Field(
        ...,
        min_length=1,
        serialization_alias="workingUrdfPath",
        validation_alias=AliasChoices("workingUrdfPath", "working_urdf_path"),
    )
