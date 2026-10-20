import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Step } from './Steps';
import { SchemeSettings } from './settingsFields';
import { getAssetType } from './assetTypes';

test('a closed step shows its summary; an open one its contents and Next', () => {
  const onToggle = jest.fn();
  const onNext = jest.fn();
  const { rerender } = render(
    <Step index={2} id="use" title="Use" summary="Multifamily · standard defaults" status="done" open={false} onToggle={onToggle} onNext={onNext}>
      <p>inside</p>
    </Step>
  );
  expect(screen.getByText('Multifamily · standard defaults')).toBeInTheDocument();
  expect(screen.queryByText('inside')).not.toBeInTheDocument();
  expect(screen.getByText('✓')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Use/ }));
  expect(onToggle).toHaveBeenCalledWith('use');
  rerender(
    <Step index={2} id="use" title="Use" summary="Multifamily · standard defaults" status="todo" open onToggle={onToggle} onNext={onNext}>
      <p>inside</p>
    </Step>
  );
  expect(screen.getByText('inside')).toBeInTheDocument();
  expect(screen.queryByText('Multifamily · standard defaults')).not.toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  expect(onNext).toHaveBeenCalled();
});

test('a step can show just its own settings group, laid out flat', () => {
  render(<SchemeSettings type={getAssetType('mf-garden')} overrides={{ maxFar: 2 }} onChange={() => {}} idPrefix="x" only={['Zoning']} />);
  expect(screen.getByText('Max FAR')).toBeInTheDocument();
  expect(screen.getByText('Max height')).toBeInTheDocument();
  expect(screen.queryByText('Floors')).not.toBeInTheDocument();
  expect(screen.queryByText('Unit mix')).not.toBeInTheDocument();
  expect(screen.queryByText('Building orientation')).not.toBeInTheDocument();
  expect(screen.getByText('1 changed from the defaults')).toBeInTheDocument();
});

test('the Use step shows the program and the unit mix', () => {
  render(<SchemeSettings type={getAssetType('mf-garden')} overrides={{}} onChange={() => {}} idPrefix="y" only={['Program']} />);
  expect(screen.getByText('Floors')).toBeInTheDocument();
  expect(screen.getByText('Unit mix')).toBeInTheDocument();
  expect(screen.queryByText('Max FAR')).not.toBeInTheDocument();
});
