/**
 * Pure tree utility functions for managing split pane layout
 */

export function generateSessionId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return 'pane-' + crypto.randomUUID();
    }
  } catch (e) {}
  return 'pane-' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
}

/**
 * Find node in tree by id
 */
function findNode(node, targetId) {
  if (node.id === targetId) return node;
  if (node.type === 'split') {
    const left = findNode(node.children[0], targetId);
    if (left) return left;
    return findNode(node.children[1], targetId);
  }
  return null;
}

/**
 * Split a pane: find target node, replace it with a new split containing the original and a new pane
 * Returns { newNode: updatedTree, newPaneId: string | null }
 */
export function splitNode(node, targetId, direction, initialCwd = null) {
  const doSplit = (currNode) => {
    if (currNode.id === targetId) {
      const newPaneId = generateSessionId();
      const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

      return {
        newNode: {
          type: 'split',
          id: 'split-' + randomSuffix,
          direction,
          children: [
            currNode,
            {
              type: 'pane',
              id: newPaneId,
              sessionId: newPaneId,
              initialCwd: initialCwd
            }
          ],
          sizes: [50, 50]
        },
        newPaneId
      };
    }

    if (currNode.type === 'split') {
      const leftResult = doSplit(currNode.children[0]);
      if (leftResult.newPaneId) {
        const newChildren = [leftResult.newNode, currNode.children[1]];
        // Only recalculate this split's sizes if its direction matches the new split direction
        let newSizes = currNode.sizes || [50, 50];
        if (currNode.direction === direction) {
          const lw = axisWeight(newChildren[0], currNode.direction);
          const rw = axisWeight(newChildren[1], currNode.direction);
          newSizes = [(lw / (lw + rw)) * 100, (rw / (lw + rw)) * 100];
        }
        return {
          newNode: { ...currNode, children: newChildren, sizes: newSizes },
          newPaneId: leftResult.newPaneId
        };
      }

      const rightResult = doSplit(currNode.children[1]);
      if (rightResult.newPaneId) {
        const newChildren = [currNode.children[0], rightResult.newNode];
        let newSizes = currNode.sizes || [50, 50];
        if (currNode.direction === direction) {
          const lw = axisWeight(newChildren[0], currNode.direction);
          const rw = axisWeight(newChildren[1], currNode.direction);
          newSizes = [(lw / (lw + rw)) * 100, (rw / (lw + rw)) * 100];
        }
        return {
          newNode: { ...currNode, children: newChildren, sizes: newSizes },
          newPaneId: rightResult.newPaneId
        };
      }
    }
    return { newNode: currNode, newPaneId: null };
  };

  return doSplit(node);
}

/**
 * Close a pane: find target node, remove it, promote sibling if needed
 */
export function closeNode(node, targetId) {
  if (node.id === targetId) {
    return null; // signal to remove this node
  }

  if (node.type === 'split') {
    const newLeft = closeNode(node.children[0], targetId);
    const newRight = closeNode(node.children[1], targetId);

    // If left was removed, return right (promote right)
    if (newLeft === null) return newRight;
    // If right was removed, return left (promote left)
    if (newRight === null) return newLeft;
    // Neither was removed, return split with new children
    return {
      ...node,
      children: [newLeft, newRight]
    };
  }

  return node;
}

/**
 * Count total number of panes in the tree
 */
export function countPanes(node) {
  if (node.type === 'pane') return 1;
  return countPanes(node.children[0]) + countPanes(node.children[1]);
}

/**
 * Find the first (leftmost/topmost) pane id in the tree
 */
export function findFirstPaneId(node) {
  if (node.type === 'pane') return node.id;
  return findFirstPaneId(node.children[0]);
}

/**
 * Collect all pane ids in the tree
 */
export function getAllPaneIds(node) {
  if (node.type === 'pane') return [node.id];
  return [
    ...getAllPaneIds(node.children[0]),
    ...getAllPaneIds(node.children[1])
  ];
}

/**
 * Count panes that are "in the same axis" as the given direction.
 * Sub-splits in a different direction count as 1 (they don't compete for space on this axis).
 */
function axisWeight(node, direction) {
  if (node.type === 'pane') return 1;
  if (node.direction === direction) return axisWeight(node.children[0], direction) + axisWeight(node.children[1], direction);
  return 1;
}

/**
 * Redistribute sizes so panes sharing the same axis get equal space.
 * targetDirection: if provided, only nodes with this direction are recalculated.
 */
export function redistributeSizes(node, targetDirection = null) {
  if (node.type === 'pane') return node;

  const leftWeight = axisWeight(node.children[0], node.direction);
  const rightWeight = axisWeight(node.children[1], node.direction);
  const total = leftWeight + rightWeight;

  // Only update sizes if we are rebalancing everything (null) or if this node's axis matches target
  const newSizes = (!targetDirection || node.direction === targetDirection)
    ? [(leftWeight / total) * 100, (rightWeight / total) * 100]
    : (node.sizes || [50, 50]);

  return {
    ...node,
    sizes: newSizes,
    children: [
      redistributeSizes(node.children[0], targetDirection),
      redistributeSizes(node.children[1], targetDirection)
    ]
  };
}

/**
 * Find a pane node by id in the tree
 */
export function findPaneNode(node, paneId) {
  if (node.type === 'pane' && node.id === paneId) return node;
  if (node.type === 'split') {
    const left = findPaneNode(node.children[0], paneId);
    if (left) return left;
    return findPaneNode(node.children[1], paneId);
  }
  return null;
}

/**
 * A stacked split whose two halves are side-by-side splits with aligned columns
 * ([A|B] over [C|D]) shares one divider across both columns. Regroup it by column
 * ([A over C] | [B over D]) so each column's divider moves on its own.
 * Visual layout is unchanged; returns the node untouched if it doesn't fit that shape.
 */
export function canRegroupByColumn(node) {
  if (!node || node.type !== 'split' || node.direction !== 'horizontal') return false;
  const [top, bottom] = node.children;
  return top.type === 'split' && bottom.type === 'split'
    && top.direction === 'vertical' && bottom.direction === 'vertical'
    && Math.abs((top.sizes?.[0] ?? 50) - (bottom.sizes?.[0] ?? 50)) <= 1;
}

export function regroupByColumn(root, splitId) {
  const walk = (node) => {
    if (node.id === splitId && canRegroupByColumn(node)) {
      const [top, bottom] = node.children;
      const stack = (id, a, b) => ({ type: 'split', id, direction: 'horizontal', children: [a, b], sizes: node.sizes || [50, 50] });
      return {
        type: 'split',
        id: bottom.id,
        direction: 'vertical',
        children: [
          stack(node.id, top.children[0], bottom.children[0]),
          stack(node.id + '-r', top.children[1], bottom.children[1])
        ],
        sizes: bottom.sizes || [50, 50]
      };
    }
    if (node.type === 'split') {
      return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
    }
    return node;
  };
  return walk(root);
}
