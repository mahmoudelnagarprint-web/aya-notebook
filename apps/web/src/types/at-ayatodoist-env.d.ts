import type { AppRuntime, RuntimeActions } from '@ayatodoist/plugin-sdk/react';
import type { Kernel } from '@ayatodoist/core-kernel';

declare module '@ayatodoist/plugin-sdk/react' {
  function useRuntime(): AppRuntime;
  function useKernel(): Kernel;
}
