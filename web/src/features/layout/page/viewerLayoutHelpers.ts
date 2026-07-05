import { TOP_NAV_HEIGHT } from "@/features/layout/page/constants";

export const resolveViewerLayoutMainStyle = ({
  isRightSidebarCollapsed,
  isSidebarCollapsed,
  rightSidebarWidth,
  sidebarWidth,
}: {
  isRightSidebarCollapsed: boolean;
  isSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  sidebarWidth: number;
}) => ({
  marginLeft: isSidebarCollapsed ? 0 : sidebarWidth,
  marginRight: isRightSidebarCollapsed ? 0 : rightSidebarWidth,
  marginTop: TOP_NAV_HEIGHT,
});
