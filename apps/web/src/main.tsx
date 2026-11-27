import { createRoot } from 'react-dom/client';
import { KernelProvider, setCommandErrorHandler } from '@ayatodoist/plugin-sdk/react';
import './styles.css';
import { bootstrapSnapshot, createBrowserKernel } from './app/bootstrap';
import { runtimeStore } from './app/runtime';
import { Shell } from './components/Shell';

const kernel = createBrowserKernel();
runtimeStore.init(kernel, kernel.getSettings());
setCommandErrorHandler((message) => runtimeStore.toast(message, 'error'));

window.addEventListener('hashchange', () => runtimeStore.syncRoute());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

createRoot(rootElement).render(
  <KernelProvider kernel={kernel}>
    <Shell />
  </KernelProvider>,
);

// First paint is instant and local; the server snapshot hydrates right after.
void bootstrapSnapshot(kernel).then((applied) => {
  if (applied && applied > 0) runtimeStore.toast(`تمت مزامنة ${applied} سجلاً من الخادم`, 'success');
});
