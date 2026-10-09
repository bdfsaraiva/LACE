import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgreementAnalysisChatRoom from './AgreementAnalysisChatRoom';

const { mockProjects, mockAgreement, mockWaitForPendingWrites } = vi.hoisted(() => ({
  mockProjects: {
    getChatRoom: vi.fn(),
    getChatMessages: vi.fn(),
    getChatRoomCompletion: vi.fn(),
    updateChatRoomCompletion: vi.fn(),
  },
  mockAgreement: {
    getChatRoomAnnotations: vi.fn(),
    upsertAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    finishRoom: vi.fn(),
  },
  mockWaitForPendingWrites: vi.fn(() => Promise.resolve()),
}));

vi.mock('../utils/api', () => ({
  projects: mockProjects,
  agreementAnalysis: mockAgreement,
  waitForPendingWrites: mockWaitForPendingWrites,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 1, username: 'alice' } }),
}));

const MESSAGES = [
  { id: 10, turn_id: '1', user_id: 'u1', turn_text: 'I completely agree with you.' },
  { id: 11, turn_id: '2', user_id: 'u2', turn_text: 'That is interesting.' },
];

/** A saved row for the current annotator. */
const savedRow = (fields) => ({
  id: 100 + fields.message_id,
  annotator_id: 1,
  annotator_username: 'alice',
  marker_check: null,
  marker_span: '',
  borderline: false,
  multiform: false,
  ...fields,
});

const renderRoom = async (initialRows = []) => {
  mockAgreement.getChatRoomAnnotations.mockResolvedValue(initialRows);
  render(
    <MemoryRouter initialEntries={['/projects/5/chat-rooms/7']}>
      <Routes>
        <Route path="/projects/:projectId/chat-rooms/:roomId" element={<AgreementAnalysisChatRoom />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('E2E Room');
};

/** Expand the first turn's annotation panel. */
const expandFirstTurn = () => fireEvent.click(screen.getAllByTitle('Expand')[0]);

describe('AgreementAnalysisChatRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects.getChatRoom.mockResolvedValue({ id: 7, name: 'E2E Room' });
    mockProjects.getChatMessages.mockResolvedValue({ messages: MESSAGES });
    mockProjects.getChatRoomCompletion.mockResolvedValue({ is_completed: false });
    mockAgreement.upsertAnnotation.mockImplementation(async (projectId, roomId, payload) => savedRow(payload));
  });

  it('offers only the checks of the chosen polarity and clears the check when the polarity changes', async () => {
    await renderRoom();
    expandFirstTurn();

    fireEvent.click(screen.getByLabelText('Agreement-form'));
    expect(screen.getByLabelText(/Agreement verb/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Disagreement verb/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Agreement verb/));
    await waitFor(() => expect(mockAgreement.upsertAnnotation).toHaveBeenCalledTimes(2));
    expect(mockAgreement.upsertAnnotation.mock.calls[1][2]).toMatchObject({
      message_id: 10, form: 'agreement-form', marker_check: 'agreement_verb',
    });

    fireEvent.click(screen.getByLabelText('Disagreement-form'));
    await waitFor(() => expect(mockAgreement.upsertAnnotation).toHaveBeenCalledTimes(3));
    expect(mockAgreement.upsertAnnotation.mock.calls[2][2]).toMatchObject({
      form: 'disagreement-form', marker_check: null,
    });
    expect(screen.getByLabelText(/Disagreement verb/)).toBeInTheDocument();
  });

  it('saves "Not marked" as form none with the marker fields cleared', async () => {
    await renderRoom();
    expandFirstTurn();

    fireEvent.click(screen.getByLabelText('Not marked'));

    await waitFor(() => expect(mockAgreement.upsertAnnotation).toHaveBeenCalledTimes(1));
    expect(mockAgreement.upsertAnnotation.mock.calls[0][2]).toEqual({
      message_id: 10, form: 'none', marker_check: null, marker_span: '', borderline: false, multiform: false,
    });
  });

  it('saves the cited span when the field loses focus, and copies selected turn text into it', async () => {
    await renderRoom([savedRow({ message_id: 10, form: 'agreement-form', marker_check: 'agreement_verb' })]);
    expandFirstTurn();

    const spanInput = screen.getByPlaceholderText('e.g. I completely agree');
    fireEvent.change(spanInput, { target: { value: 'I completely agree' } });
    fireEvent.blur(spanInput);
    await waitFor(() => expect(mockAgreement.upsertAnnotation).toHaveBeenCalledTimes(1));
    expect(mockAgreement.upsertAnnotation.mock.calls[0][2].marker_span).toBe('I completely agree');

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'agree with you' });
    fireEvent.click(screen.getByRole('button', { name: 'Use selected text' }));
    await waitFor(() => expect(mockAgreement.upsertAnnotation).toHaveBeenCalledTimes(2));
    expect(mockAgreement.upsertAnnotation.mock.calls[1][2].marker_span).toBe('agree with you');
    getSelection.mockRestore();
  });

  it('blocks "Finish room" while a marked turn is incomplete', async () => {
    await renderRoom([savedRow({ message_id: 10, form: 'agreement-form', marker_check: 'agreement_verb' })]);

    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish room' })).toBeDisabled();
  });

  it('finishes the room after confirmation, saving undecided turns as Not marked', async () => {
    await renderRoom([savedRow({
      message_id: 10, form: 'agreement-form', marker_check: 'agreement_verb', marker_span: 'I completely agree',
    })]);
    mockAgreement.finishRoom.mockResolvedValue({ filled_count: 1, is_completed: true });

    fireEvent.click(screen.getByRole('button', { name: 'Finish room' }));
    expect(screen.getByText(/1 turn without a decision will be saved as "Not marked"/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish room' }).at(-1));

    await screen.findByText('Room finished');
    expect(mockWaitForPendingWrites).toHaveBeenCalled();
    expect(mockAgreement.finishRoom).toHaveBeenCalledWith('5', '7');
  });
});
