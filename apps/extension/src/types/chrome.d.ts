/**
 * Minimal Chrome extension API types used by the extension source.
 * Only the surface the extension actually uses is declared; the rest stays
 * implicit so the real chrome.xxx objects at runtime are untyped but fine.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

declare namespace chrome {
  // storage
  const storage: {
    local: {
      get(keys: string | string[] | { [key: string]: any }, callback: (result: any) => void): void;
      set(items: { [key: string]: any }, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
    };
    onChanged: {
      addListener(callback: (changes: { [key: string]: any }, areaName: string) => void): void;
    };
  };

  // tabs
  const tabs: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: chrome.tabs.Tab[]) => void): void;
    sendMessage(tabId: number, message: any, options?: any, responseCallback?: (response: any) => void): void;
    create(createProperties: { url?: string }, callback?: (tab: chrome.tabs.Tab) => void): void;
  };

  // contextMenus
  const contextMenus: {
    remove(menuItemId: string | number, callback?: () => void): void;
    removeAll(callback?: () => void): void;
    create(createProperties: any, callback?: () => void): void;
    onClicked: {
      addListener(
        listener: (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) => void,
      ): void;
    };
  };

  // alarms
  const alarms: {
    create(name: string, alarmInfo?: { delayInMinutes?: number; periodInMinutes?: number }, callback?: () => void): void;
    onAlarm: { addListener(listener: (alarm: chrome.alarms.Alarm) => void): void };
    get(name: string, callback: (alarm: chrome.alarms.Alarm | undefined) => void): void;
  };

  // runtime
  const runtime: {
    onInstalled: { addListener(listener: () => void): void };
    onMessage: {
      addListener(
        listener: (
          message: any,
          sender: any,
          sendResponse: (response: any) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage(message: any, callback?: (response: any) => void): void;
    openPopup(): void;
    getPlatformInfo(callback: (info: { os: string }) => void): void;
  };

  // notifications
  const notifications: {
    create(createProperties: any, callback?: () => void): void;
  };

  // commands
  const commands: {
    onCommand: { addListener(listener: (command: string) => void): void };
  };

  // sidePanel (Chrome 114+)
  const sidePanel: {
    open(options?: { windowId?: number }): void;
    setPanelBehavior(options: { openPanelOnActionClick?: boolean }, callback?: () => void): void;
  };

  // windows
  const windows: {
    getLastFocused(options?: any, callback: (window: chrome.windows.Window) => void): void;
  };

  // action
  const action: {
    setBadgeText(options: { text?: string; tabId?: number }): void;
    setBadgeBackgroundColor(options: { color: string | number[]; tabId?: number }): void;
    openPopup(): void;
  };
}

declare namespace chrome.tabs {
  interface Tab {
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
    highlighted?: boolean;
    mutedInfo?: any;
    openerTabId?: number;
    windowId?: number;
  }
}

declare namespace chrome.contextMenus {
  interface OnClickData {
    menuItemId: string | number;
    linkUrl?: string;
    srcUrl?: string;
    pageUrl?: string;
    title?: string;
    selectionText?: string;
    editable?: boolean;
    isEditable?: boolean;
    altText?: string;
    mediaType?: string;
    srcUrl?: string;
    pageUrl?: string;
    frameUrl?: string;
    documentUrl?: string;
    tab?: chrome.tabs.Tab;
    leftButtonClicked?: boolean;
    middleButtonClicked?: boolean;
    rightButtonClicked?: boolean;
    inputFieldCustomData?: string;
    wasClicked?: boolean;
  }
}

declare namespace chrome.alarms {
  interface Alarm {
    name: string;
    scheduledTime: number;
    periodInMinutes?: number;
    periodQuery: string;
  }
}

declare namespace chrome.windows {
  interface Window {
    id?: number;
    type: string;
    state: string;
  }
}
