import { lazy, type ComponentType } from "react";

type ModuleNamedComponent<TModule, TKey extends keyof TModule> =
  TModule[TKey] extends ComponentType<infer TProps> ? ComponentType<TProps> : never;

export const lazyNamedComponent = <
  TModule,
  TKey extends keyof TModule & string,
>(
  loadModule: () => Promise<TModule>,
  exportName: TKey
) =>
  lazy<ModuleNamedComponent<TModule, TKey>>(async () => {
    const module = await loadModule();
    return {
      default: module[exportName] as ModuleNamedComponent<TModule, TKey>,
    };
  });
