export const LISTS_APP_ID = "lists";

export const CREATE_NODE_ID = "lists:create";
export const CREATE_EDIT_NODE_ID = "lists:create:edit";
/** Landing tip for create-list action before the result repairs the tip id. */
export const CREATE_RESULT_NODE_ID = "lists:create:result";

export type ListsNode =
  | { readonly kind: "create" }
  | { readonly kind: "createEdit" }
  | { readonly kind: "createResult" }
  | { readonly kind: "catalogList"; readonly listId: string }
  | { readonly kind: "add"; readonly listId: string }
  | { readonly kind: "addEdit"; readonly listId: string }
  | { readonly kind: "addResult"; readonly listId: string }
  | { readonly kind: "completedOpen"; readonly listId: string }
  | { readonly kind: "completedEmpty"; readonly listId: string }
  | { readonly kind: "delete"; readonly listId: string }
  | { readonly kind: "deleteConfirm"; readonly listId: string }
  | { readonly kind: "deleted"; readonly listId: string }
  | { readonly kind: "activeItem"; readonly itemId: string }
  | { readonly kind: "itemDone"; readonly itemId: string }
  | { readonly kind: "itemUndo"; readonly itemId: string }
  | { readonly kind: "completedItem"; readonly itemId: string }
  | { readonly kind: "itemRestored"; readonly itemId: string };

export function catalogListNodeId(listId: string): string {
  return `lists:list:${listId}`;
}

export function addNodeId(listId: string): string {
  return `lists:list:${listId}:add`;
}

export function addEditNodeId(listId: string): string {
  return `lists:list:${listId}:add:edit`;
}

export function addResultNodeId(listId: string): string {
  return `lists:list:${listId}:add:result`;
}

export function completedOpenNodeId(listId: string): string {
  return `lists:list:${listId}:completed`;
}

export function completedEmptyNodeId(listId: string): string {
  return `lists:list:${listId}:completed:empty`;
}

export function deleteNodeId(listId: string): string {
  return `lists:list:${listId}:delete`;
}

export function deleteConfirmNodeId(listId: string): string {
  return `lists:list:${listId}:delete:confirm`;
}

export function deletedNodeId(listId: string): string {
  return `lists:list:${listId}:deleted`;
}

export function activeItemNodeId(itemId: string): string {
  return `lists:item:${itemId}`;
}

export function itemDoneNodeId(itemId: string): string {
  return `lists:item:${itemId}:done`;
}

export function itemUndoNodeId(itemId: string): string {
  return `lists:item:${itemId}:undo`;
}

export function completedItemNodeId(itemId: string): string {
  return `lists:item:${itemId}:completed`;
}

export function itemRestoredNodeId(itemId: string): string {
  return `lists:item:${itemId}:restored`;
}

export function parseListsNode(nodeId: string): ListsNode | null {
  if (nodeId === CREATE_NODE_ID) {
    return { kind: "create" };
  }
  if (nodeId === CREATE_EDIT_NODE_ID) {
    return { kind: "createEdit" };
  }
  if (nodeId === CREATE_RESULT_NODE_ID) {
    return { kind: "createResult" };
  }

  const listMatch = /^lists:list:([^:]+)(?::(.+))?$/.exec(nodeId);
  if (listMatch) {
    const listId = listMatch[1]!;
    const rest = listMatch[2];
    if (!rest) {
      return { kind: "catalogList", listId };
    }
    switch (rest) {
      case "add":
        return { kind: "add", listId };
      case "add:edit":
        return { kind: "addEdit", listId };
      case "add:result":
        return { kind: "addResult", listId };
      case "completed":
        return { kind: "completedOpen", listId };
      case "completed:empty":
        return { kind: "completedEmpty", listId };
      case "delete":
        return { kind: "delete", listId };
      case "delete:confirm":
        return { kind: "deleteConfirm", listId };
      case "deleted":
        return { kind: "deleted", listId };
      default:
        return null;
    }
  }

  const itemMatch = /^lists:item:([^:]+)(?::(.+))?$/.exec(nodeId);
  if (itemMatch) {
    const itemId = itemMatch[1]!;
    const rest = itemMatch[2];
    if (!rest) {
      return { kind: "activeItem", itemId };
    }
    switch (rest) {
      case "done":
        return { kind: "itemDone", itemId };
      case "undo":
        return { kind: "itemUndo", itemId };
      case "completed":
        return { kind: "completedItem", itemId };
      case "restored":
        return { kind: "itemRestored", itemId };
      default:
        return null;
    }
  }

  return null;
}

export function listIdFromNode(parsed: ListsNode): string | null {
  if ("listId" in parsed) {
    return parsed.listId;
  }
  return null;
}

export function itemIdFromNode(parsed: ListsNode): string | null {
  if ("itemId" in parsed) {
    return parsed.itemId;
  }
  return null;
}

/**
 * First line for list titles and item bodies.
 * Empty → a spoken placeholder so the tip is never blank.
 */
export function firstLineLabel(text: string, emptyLabel: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const trimmed = line.trim();
  return trimmed.length > 0 ? trimmed : emptyLabel;
}
