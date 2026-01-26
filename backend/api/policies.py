from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from backend.robotops.policies import list_policies, PolicyInfo

router = APIRouter(prefix="/policies", tags=["policies"])

class PolicyResponse(BaseModel):
    id: str
    name: str
    description: str
    source: str
    default_config: dict
    input_modalities: List[str]
    version: Optional[str] = None

class PoliciesListResponse(BaseModel):
    policies: List[PolicyResponse]
    total: int
    fallback_used: bool = False

@router.get("", response_model=PoliciesListResponse)
async def get_policies(refresh: bool = False):
    """List available policy architectures."""
    policies = list_policies(refresh=refresh)

    return PoliciesListResponse(
        policies=[
            PolicyResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                source=p.source,
                default_config=p.default_config,
                input_modalities=p.input_modalities,
                version=p.version,
            )
            for p in policies
        ],
        total=len(policies),
        fallback_used=len(policies) == 2,  # Fallback has exactly 2 policies
    )

@router.get("/{policy_id}", response_model=PolicyResponse)
async def get_policy(policy_id: str):
    """Get details for a specific policy."""
    policies = list_policies()

    for p in policies:
        if p.id == policy_id:
            return PolicyResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                source=p.source,
                default_config=p.default_config,
                input_modalities=p.input_modalities,
                version=p.version,
            )

    raise HTTPException(status_code=404, detail=f"Policy '{policy_id}' not found")
