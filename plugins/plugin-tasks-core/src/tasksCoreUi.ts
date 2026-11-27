import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import { CompletedView, InboxView, ProjectView, TodayView, UpcomingView } from './ui';

/** The tasks-core UI contribution: one route per primary view. */
export const tasksCoreUi: PluginUiModule = {
  id: 'tasks-core',
  routes: {
    inbox: InboxView,
    today: TodayView,
    upcoming: UpcomingView,
    project: ProjectView,
    completed: CompletedView,
  },
};
