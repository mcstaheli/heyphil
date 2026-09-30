import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findMentionQuery, matchPeople, applyMention, mentionListPosition } from './taskAssign';

const ROW_HEIGHT = 32; // px per team member in the list, for flip-above sizing

// A task text input with "@" assignment: typing "@" (at the start or after a
// space) opens a list of team members; ↑/↓ + Enter/Tab or a click picks one,
// which assigns the task to them and removes the "@name" text. The chosen
// assignee shows as a chip (× to clear) in front of the input.
//
// Used by the board's quick-add box and CardModal's "Add a next action" box.
// Enter with the list closed calls onSubmit; every other key (e.g. Escape
// with the list closed) goes to the caller's onKeyDown.
function AssigneeInput({
  value,
  onChange,
  assignee,
  onAssigneeChange,
  people,        // array of team member names
  renderAvatar,  // (name, size) => avatar element
  onSubmit,
  onKeyDown,
  onBlur,
  placeholder,
  className,
  autoFocus
}) {
  const inputRef = useRef(null);
  const [mention, setMention] = useState(null); // { start, query } while the list is open
  const [highlight, setHighlight] = useState(0);

  const matches = mention ? matchPeople(people, mention.query) : [];
  const listOpen = mention && matches.length > 0;

  // The list is portalled to <body> and positioned against the input -
  // the add-task boxes live inside scrolling containers (card modal's
  // Next Actions column, the board's card lists) that clipped it when it
  // was a plain absolutely-positioned child. Re-placed on scroll/resize.
  const [listPos, setListPos] = useState(null);
  useLayoutEffect(() => {
    if (!listOpen) return undefined;
    const place = () => {
      if (!inputRef.current) return;
      setListPos(mentionListPosition(
        inputRef.current.getBoundingClientRect(),
        window.innerHeight,
        matches.length * ROW_HEIGHT + 8
      ));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [listOpen, matches.length]);

  const updateMention = (text, caret) => {
    const found = findMentionQuery(text, caret);
    setMention(found);
    setHighlight(0);
  };

  const pick = (name) => {
    const { text, caret } = applyMention(value, mention);
    onChange(text);
    onAssigneeChange(name);
    setMention(null);
    // Put the caret back where the "@name" was
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(caret, caret);
      }
    });
  };

  const handleKeyDown = (e) => {
    if (listOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(highlight, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        // Close just the list, not whatever the input lives in
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (onSubmit) onSubmit();
      return;
    }
    if (onKeyDown) onKeyDown(e);
  };

  return (
    <div className={`assignee-input ${className || ''}`}>
      {assignee && (
        <span className="assignee-chip" title={`Assigned to ${assignee}`}>
          {renderAvatar(assignee, 18)}
          <span className="assignee-chip-name">{assignee}</span>
          <button
            type="button"
            className="assignee-chip-clear"
            title="Unassign"
            // mousedown + preventDefault keeps focus in the input (the
            // board's quick-add box closes on blur)
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onAssigneeChange(null);
              if (inputRef.current) inputRef.current.focus();
            }}
          >×</button>
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          updateMention(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          setMention(null);
          if (onBlur) onBlur(e);
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {listOpen && listPos && createPortal(
        <ul className="assignee-mention-list" role="listbox" style={{ position: 'fixed', ...listPos }}>
          {matches.map((name, idx) => (
            <li
              key={name}
              role="option"
              aria-selected={idx === highlight}
              className={idx === highlight ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(idx)}
              onClick={(e) => {
                e.stopPropagation();
                pick(name);
              }}
            >
              {renderAvatar(name, 20)}
              <span>{name}</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

export default AssigneeInput;
