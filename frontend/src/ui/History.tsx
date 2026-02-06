import React, { useCallback, useReducer, Reducer } from 'react';

export interface HistoryEntry<T> {
  value: T;
  timestamp: number;
}

interface HistoryState<T> {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
}

type HistoryAction<T> = 
  | { type: 'PUSH'; value: T }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' };

export const useHistory = <T,>(initialState: T) => {
  const historyReducer: Reducer<HistoryState<T>, HistoryAction<T>> = (state, action) => {
    switch (action.type) {
      case 'PUSH':
        return {
          past: [...state.past, { value: state.present, timestamp: Date.now() }],
          present: action.value,
          future: [],
        };
      case 'UNDO':
        if (state.past.length === 0) return state;
        const newPast = state.past.slice(0, -1);
        const previousPresent = newPast.length > 0 ? newPast[newPast.length - 1].value : initialState;
        return {
          past: newPast,
          present: previousPresent,
          future: [{ value: state.present, timestamp: Date.now() }, ...state.future],
        };
      case 'REDO':
        if (state.future.length === 0) return state;
        const nextFuture = state.future.slice(1);
        return {
          past: [...state.past, { value: state.present, timestamp: Date.now() }],
          present: state.future[0].value,
          future: nextFuture,
        };
      case 'CLEAR':
        return {
          past: [],
          present: initialState,
          future: [],
        };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialState,
    future: [],
  });

  const push = useCallback((value: T) => {
    dispatch({ type: 'PUSH', value });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  return {
    value: state.present,
    push,
    undo,
    redo,
    clear,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    history: {
      past: state.past,
      future: state.future,
    },
  };
};

interface UndoRedoControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const UndoRedoControls: React.FC<UndoRedoControlsProps> = ({ canUndo, canRedo, onUndo, onRedo }) => {
  return (
    <div className="undo-redo-controls" role="toolbar" aria-label="Undo/redo actions">
      <button
        className="undo-redo-btn undo-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Cmd+Z)"
        aria-label="Undo"
      >
        ↶ Undo
      </button>
      <button
        className="undo-redo-btn redo-btn"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Cmd+Shift+Z)"
        aria-label="Redo"
      >
        ↷ Redo
      </button>
    </div>
  );
};
