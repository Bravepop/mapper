import './style.css';
import { App } from './app';
import { FileActions } from './core/fileio';
import { Autosave } from './core/storage';
import { buildUi } from './ui/ui';

async function start(): Promise<void> {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const app = new App(canvas);
  const autosave = new Autosave(app);
  await autosave.load();
  const files = new FileActions(app, autosave);
  buildUi(app, files, autosave);
  app.viewChanged();
  canvas.focus();

  // Handy for debugging from the browser console.
  (window as unknown as { mapper: App }).mapper = app;
}

void start();
