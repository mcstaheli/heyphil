import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AssigneeInput from './AssigneeInput';

function Harness({ people = ['Chad', 'Greg', 'Tracy'], onSubmit = () => {} }) {
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState(null);
  return (
    <div>
      <AssigneeInput
        placeholder="Add a task"
        value={text}
        onChange={setText}
        assignee={assignee}
        onAssigneeChange={setAssignee}
        people={people}
        renderAvatar={(name) => <span data-testid="avatar">{name[0]}</span>}
        onSubmit={() => onSubmit(text, assignee)}
      />
      <output data-testid="state">{JSON.stringify({ text, assignee })}</output>
    </div>
  );
}

function type(input, value) {
  // what a real keystroke does: value changes and the caret sits at the end
  input.setSelectionRange && input.focus();
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

test('typing @ opens the team list', () => {
  render(<Harness />);
  const input = screen.getByPlaceholderText('Add a task');
  type(input, 'Call bank @');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['CChad', 'GGreg', 'TTracy']);
});

test('filters as you type and Enter picks the highlighted person', () => {
  const onSubmit = jest.fn();
  render(<Harness onSubmit={onSubmit} />);
  const input = screen.getByPlaceholderText('Add a task');
  type(input, 'Call bank @gr');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['GGreg']);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId('state').textContent)).toEqual({ text: 'Call bank', assignee: 'Greg' });
  expect(onSubmit).not.toHaveBeenCalled(); // Enter picked a person, didn't submit
});

test('clicking a person picks them', () => {
  render(<Harness />);
  const input = screen.getByPlaceholderText('Add a task');
  type(input, '@');
  fireEvent.click(screen.getByText('Tracy'));
  expect(JSON.parse(screen.getByTestId('state').textContent).assignee).toBe('Tracy');
});

test('Enter with the list closed passes the input to onSubmit (edit boxes blur to save)', () => {
  const onSubmit = jest.fn();
  render(
    <AssigneeInput
      placeholder="Edit"
      value="Call bank"
      onChange={() => {}}
      assignee="Greg"
      onAssigneeChange={() => {}}
      people={['Greg']}
      renderAvatar={() => null}
      onSubmit={onSubmit}
    />
  );
  const input = screen.getByPlaceholderText('Edit');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith(input);
  // the current assignee shows as a chip in the edit box
  expect(screen.getByTitle('Assigned to Greg')).toHaveTextContent('Greg');
});
