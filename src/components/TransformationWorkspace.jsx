import { supportedFunctions } from '../engine/catalog.js';
import ContextPanel from './ContextPanel';
import EntityToolbar from './EntityToolbar';
import JsonEditor from './JsonEditor';
import NoticeBanner from './NoticeBanner';
import Results from './Results';
import RunToolbar from './RunToolbar';

export default function TransformationWorkspace({ workspace }) {
  const { state, payload, running, ...actions } = workspace;
  const { setField } = actions;
  return (
    <>
      <RunToolbar
        example={state.example}
        mode={state.mode}
        running={running}
        onExample={actions.loadExample}
        onMode={(mode) => setField('mode', mode)}
        onRun={actions.run}
      />
      <EntityToolbar
        entityType={state.entityType}
        entityPath={state.entityPath}
        debug={state.debug}
        running={running}
        onEntityType={(type) => setField('entityType', type)}
        onEntityPath={(path) => setField('entityPath', path)}
        onDetect={actions.detect}
        onDebug={(debug) => setField('debug', debug)}
        onImport={actions.importCase}
        onExport={actions.exportCase}
        onClear={actions.clear}
      />
      <NoticeBanner notice={state.notice} onDismiss={actions.dismissNotice} />
      <div className="editors-grid">
        <JsonEditor
          title="Source data"
          value={state.data}
          onChange={(value) => setField('data', value)}
          payload={payload}
        />
        <JsonEditor
          title="Source transformation"
          value={state.source}
          onChange={(value) => setField('source', value)}
          payload={payload}
          functions={supportedFunctions}
          transformation
        />
        <JsonEditor
          title="Target transformation"
          value={state.target}
          onChange={(value) => setField('target', value)}
          payload={payload}
          functions={supportedFunctions}
          transformation
        />
      </div>
      <ContextPanel
        value={state.context}
        payload={payload}
        onChange={(value) => setField('context', value)}
        withGuidance
      />
      <Results result={state.result} stale={state.stale} debug={state.resultDebug} mode={state.resultMode} />
    </>
  );
}
