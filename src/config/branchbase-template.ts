import type { BranchBaseAppGroup } from "./branchbase-schema";

const TOKEN_PATTERN = /\{([^{}]+)\}/;
const BRACE_PATTERN = /[{}]/;

export interface ResolvedTemplateApp {
  directUrl?: string;
  host?: string;
  port?: number;
  url?: string;
}

export interface BranchBaseTemplateContext {
  appGroups: Record<string, { apps: Record<string, ResolvedTemplateApp> }>;
  currentGroup: string;
}

interface TemplateValue {
  ambiguous: boolean;
  value: string | null;
}

interface TemplateApp {
  directUrl?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "tcp";
  url?: string;
}

const addTemplateValue = (
  values: Map<string, TemplateValue>,
  token: string,
  value: string | null
): void => {
  const existing = values.get(token);
  values.set(token, {
    ambiguous: existing !== undefined,
    value: existing?.value ?? value,
  });
};

const addAppTemplateValues = (
  values: Map<string, TemplateValue>,
  groupId: string,
  currentGroup: string,
  appId: string,
  app: TemplateApp
): void => {
  const resolved = app.port !== undefined;
  const isHttp = resolved ? app.url !== undefined : app.protocol === "http";
  const prefixes = [`appGroups.${groupId}.apps.${appId}`];
  if (groupId === currentGroup) {
    prefixes.push(`apps.${appId}`);
  }
  for (const prefix of prefixes) {
    addTemplateValue(
      values,
      `{${prefix}.host}`,
      resolved ? (app.host ?? null) : null
    );
    addTemplateValue(
      values,
      `{${prefix}.port}`,
      resolved ? String(app.port) : null
    );
    if (isHttp) {
      addTemplateValue(
        values,
        `{${prefix}.directUrl}`,
        resolved ? (app.directUrl ?? null) : null
      );
      addTemplateValue(
        values,
        `{${prefix}.url}`,
        resolved ? (app.url ?? null) : null
      );
    }
  }
};

const templateValues = (
  appGroups: Record<
    string,
    BranchBaseAppGroup | BranchBaseTemplateContext["appGroups"][string]
  >,
  currentGroup: string
): Map<string, TemplateValue> => {
  const values = new Map<string, TemplateValue>();
  for (const [groupId, group] of Object.entries(appGroups)) {
    for (const [appId, app] of Object.entries(group.apps)) {
      addAppTemplateValues(values, groupId, currentGroup, appId, app);
    }
  }
  return values;
};

const replaceKnownTokens = (
  template: string,
  values: Map<string, TemplateValue>,
  render: boolean
): { error: string | null; value: string } => {
  let value = template;
  const tokens = [...values.keys()].toSorted(
    (left, right) => right.length - left.length
  );
  for (const token of tokens) {
    if (!value.includes(token)) {
      continue;
    }
    const resolved = values.get(token);
    if (!resolved || resolved.ambiguous) {
      return { error: `Ambiguous template token ${token}`, value };
    }
    if (render && resolved.value === null) {
      return { error: `Unsupported template token ${token}`, value };
    }
    value = value.replaceAll(token, render ? (resolved.value ?? "") : "");
  }
  const unknown = value.match(TOKEN_PATTERN)?.[0];
  if (unknown) {
    return { error: `Unsupported template token ${unknown}`, value };
  }
  if (BRACE_PATTERN.test(value)) {
    return {
      error: "Environment template contains an unmatched or unsupported brace",
      value,
    };
  }
  return { error: null, value };
};

export const branchbaseTemplateError = (
  template: string,
  appGroups: Record<string, BranchBaseAppGroup>,
  currentGroup: string
): string | null =>
  replaceKnownTokens(template, templateValues(appGroups, currentGroup), false)
    .error;

export const renderBranchBaseTemplate = (
  template: string,
  context: BranchBaseTemplateContext
): string => {
  const rendered = replaceKnownTokens(
    template,
    templateValues(context.appGroups, context.currentGroup),
    true
  );
  if (rendered.error) {
    throw new Error(rendered.error);
  }
  return rendered.value;
};

export const renameBranchBaseAppTemplateReferences = (
  template: string,
  groupId: string,
  previousId: string,
  nextId: string
): string =>
  template
    .replaceAll(`{apps.${previousId}.`, `{apps.${nextId}.`)
    .replaceAll(
      `{appGroups.${groupId}.apps.${previousId}.`,
      `{appGroups.${groupId}.apps.${nextId}.`
    );

export const renameBranchBaseAppGroupTemplateReferences = (
  template: string,
  previousId: string,
  nextId: string
): string =>
  template.replaceAll(`{appGroups.${previousId}.`, `{appGroups.${nextId}.`);
