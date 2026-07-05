import { lazy, type ComponentType } from "react";

export const lazyNamedComponent = <
  TModule,
  TKey extends keyof TModule & string,
  TComponent extends TModule[TKey] & ComponentType<any>,
>(
  loadModule: () => Promise<TModule>,
  exportName: TKey
) =>
  lazy(async () => {
    const module = await loadModule();
    return {
      default: module[exportName] as TComponent,
    };
  });
