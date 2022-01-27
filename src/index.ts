import { Document, ExtensionContext, Uri, workspace } from 'coc.nvim';

import chokidar from 'chokidar';
import parseLCOV from 'parse-lcov';
import debounce from 'lodash.debounce';
import fs from 'fs';
import path from 'path';

const DEFAULT_REPORT_PATH = '/coverage/coverage.info';
const SIGN_GROUP = 'CocLcov';
const CACHED_REPORT: { [key: string]: any } = {};

function updateSign(doc: Document, sign: string, signGroup: string, priority: number) {
  const filepath = Uri.parse(doc.uri).fsPath;
  const workspaceDir = workspace.getWorkspaceFolder(doc.uri);
  const relativeFilepath = workspaceDir ? path.relative(workspaceDir.uri, doc.uri) : '';
  const stats = CACHED_REPORT[filepath] || CACHED_REPORT[relativeFilepath];

  if (stats) {
    let uncoveredLines = stats.lines.details.filter(({ hit }) => !hit);
    workspace.nvim.setVar('coc_lcov_lines_pct', `${Math.trunc((stats.lines.hit / stats.lines.found) * 100)}`, true);

    workspace.nvim.pauseNotification();
    workspace.nvim.call('sign_unplace', [signGroup, { buffer: doc.bufnr }], true);
    uncoveredLines.forEach(({ line }) => {
      workspace.nvim.call('sign_place', [0, signGroup, sign, doc.bufnr, { lnum: line, priority }], true);
    });
    workspace.nvim.resumeNotification(false, true);
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('lcov');
  const enabled: boolean = config.get('enabled', true);
  if (!enabled) {
    return;
  }

  const signPriority: number = config.get('signPriority', 9);
  const uncoveredSign: string = config.get('uncoveredSign.text', '▣');
  const hlGroup: string = config.get('uncoveredSign.hlGroup', 'UncoveredLine');
  const reportPath: string = config.get('jsonReportPath', DEFAULT_REPORT_PATH);

  const debounceReadFile = debounce((path: string) => {
    const lcov = fs.readFileSync(path).toString();
    let json = parseLCOV(lcov).reduce((acc, rec) => {
      acc[rec.file] = rec;
      return acc;
    }, {});
    CACHED_REPORT.json = json;

    workspace.document.then((doc) => {
      updateSign(doc, 'CocLcovUncovered', SIGN_GROUP, signPriority);
    });
  }, 2000);

  function startWatch(path: string) {
    if (fs.existsSync(path)) {
      // Initial read
      debounceReadFile(path);
    }

    // Start watcher
    const watcher = chokidar.watch(path, { persistent: true });
    watcher
      .on('change', (path: string) => {
        debounceReadFile(path);
      })
      .on('add', (path: string) => {
        debounceReadFile(path);
      });
  }

  workspace.nvim.command(`sign define CocLcovUncovered text=${uncoveredSign} texthl=CocLcovUncoveredSign`, true);
  workspace.nvim.command(`hi default link CocLcovUncoveredSign ${hlGroup}`, true);

  startWatch(path.join(workspace.root, reportPath));

  context.subscriptions.push(
    workspace.registerAutocmd({
      event: ['BufEnter'],
      request: true,
      callback: async () => {
        const doc = await workspace.document;
        updateSign(doc, 'CocLcovUncovered', SIGN_GROUP, signPriority);
      },
    })
  );
}
