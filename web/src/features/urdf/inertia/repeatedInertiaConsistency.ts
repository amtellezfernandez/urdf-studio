import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_MASS_RELATIVE_SPREAD,
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_MESH_LOCAL_COM_SEPARATION_METERS,
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_PRINCIPAL_RELATIVE_SPREAD,
} from "@/features/urdf/inertia/repeatedInertiaParams";

type RepeatedInertiaConsistencyMetrics = Pick<
  RepeatedInertiaDiagnosticGroup,
  "massRelativeSpread" | "principalMomentRelativeSpread" | "meshLocalComMaxSeparationMeters"
>;

export const isRepeatedInertiaGroupAlreadyConsistent = (
  group: RepeatedInertiaConsistencyMetrics
): boolean =>
  group.massRelativeSpread <= REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_MASS_RELATIVE_SPREAD &&
  group.principalMomentRelativeSpread <=
    REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_PRINCIPAL_RELATIVE_SPREAD &&
  group.meshLocalComMaxSeparationMeters <=
    REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_MAX_MESH_LOCAL_COM_SEPARATION_METERS;
