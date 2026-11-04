import { useState } from 'react';
import AppHeader from './components/AppHeader';
import ExpressionWorkspace from './components/ExpressionWorkspace';
import Footer from './components/Footer';
import InfoDialog from './components/InfoDialog';
import TransformationWorkspace from './components/TransformationWorkspace';
import WorkspaceTabs from './components/WorkspaceTabs';
import { useWorkspace } from './hooks/useWorkspace';

const TITLES = {
  transformations: ['Transformation workspace', 'Explore the path from source data to target JSON.'],
  expressions: ['Expression workspace', 'Extract JSONPath values and evaluate IPS conditions against your payload.'],
};

export default function App() {
  const workspace = useWorkspace();
  const { state } = workspace;
  const [info, setInfo] = useState(null);
  const [title, subtitle] = TITLES[state.workspace];
  const Workspace = state.workspace === 'transformations' ? TransformationWorkspace : ExpressionWorkspace;
  return (
    <div className="app-shell">
      <div inert={info ? true : undefined}>
        <AppHeader onOpenInfo={setInfo} />
        <WorkspaceTabs workspace={state.workspace} onChange={workspace.setWorkspace} />
        <main>
          <div className="workspace-title">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <Workspace workspace={workspace} />
          <Footer
            keepOnReload={state.keepOnReload}
            storageNote={state.storageNote}
            onKeepOnReload={workspace.setKeepOnReload}
            onOpenInfo={setInfo}
          />
        </main>
      </div>
      {info ? <InfoDialog kind={info} keepOnReload={state.keepOnReload} onClose={() => setInfo(null)} /> : null}
    </div>
  );
}
