export const HEALTH_ACTION_PANEL_PARAMS = {
  labels: {
    advancedExportSection: "Export Cleanup",
  },
  materialOptions: [
    {
      id: "pla",
      label: "Light",
      description: "Plastic / PLA",
    },
    {
      id: "aluminum",
      label: "Standard",
      description: "Aluminum",
    },
    {
      id: "steel",
      label: "Heavy",
      description: "Steel",
    },
  ],
  classNames: {
    checklistCard: "rounded-md border border-border/60 bg-muted/10 p-2 text-xs text-muted-foreground",
    symmetrySubsection: "rounded border border-border/40 bg-background/20 p-2 text-xs text-muted-foreground",
    symmetrySubsectionInteractive: "cursor-pointer transition-colors hover:border-border/70 hover:bg-background/25",
    symmetrySubsectionActive: "border-sky-500/35 bg-sky-500/8",
    materialButtonGrid: "grid grid-cols-3 gap-1.5",
    materialActionButton: "h-auto items-start justify-start px-2 py-2 text-left",
    physicsSectionCard: "rounded-md border border-border/70 bg-muted/10 p-2 text-xs",
    physicsActionCard: "rounded border border-border/60 bg-background/40 p-2 text-[11px]",
    diagnosisCard: "space-y-1.5 rounded border border-amber-500/30 bg-background/40 px-2 py-1.5",
    diagnosisGroup: "rounded border border-border/40 bg-background/50 px-2 py-1.5",
    repeatedPartsGroup: "rounded border border-border/40 bg-background/30 px-2 py-1.5 text-[11px]",
    simulationPrepDisabledActionButton: "disabled:border-border/20 disabled:bg-muted/40 disabled:text-muted-foreground/70 disabled:opacity-100 disabled:cursor-not-allowed",
    visualizationToggleButtonBase: "h-4 w-4 shrink-0 rounded-sm p-0 text-muted-foreground/55 hover:bg-transparent hover:text-muted-foreground/80",
    visualizationToggleButtonActive: "bg-transparent text-muted-foreground/70",
    visualizationToggleButtonInactive: "bg-transparent",
    visualizationToggleIcon: "h-2 w-2",
    mirrorSelectionStatusBadgeBase: "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]",
    mirrorSelectionRadialBadge: "inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-amber-200/85",
  },
  radiansToDegrees: 180 / Math.PI,
} as const;
