import vscode from 'vscode';

export namespace ve {
  export const getUriKey = (uri: vscode.Uri): string => uri.toString();
  export const getSourceUri = (uri: vscode.Uri): vscode.Uri => toSourceUri(uri) ?? uri;
  export const getSourceUriKey = (uri: vscode.Uri): string => getUriKey(getSourceUri(uri));
  export const isVirtualUri = (uri: vscode.Uri): boolean => uri.scheme === Scheme;

  export const hasOpenTabForSource = (sourceUri: vscode.Uri): boolean => {
    const sourceUriKey = getUriKey(sourceUri);

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) {
          continue;
        }

        if (getSourceUriKey(tab.input.uri) === sourceUriKey) {
          return true;
        }
      }
    }

    return false;
  };

  export const closeTabsForUri = async (uri: vscode.Uri): Promise<void> => {
    const uriKey = getUriKey(uri);
    const tabs: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && getUriKey(tab.input.uri) === uriKey) {
          tabs.push(tab);
        }
      }
    }

    if (tabs.length === 0) {
      return;
    }

    await vscode.window.tabGroups.close(tabs, true);
  };
}
