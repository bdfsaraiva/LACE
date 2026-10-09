/**
 * @fileoverview Annotator interface for the ``agreement_analysis`` project type
 * (agreement/disagreement-form backbone, see docs/agreement-analysis-rubric.md).
 *
 * For each turn the annotator records, from the turn's own wording only:
 * - the form: Agreement-form, Disagreement-form, or Not marked;
 * - for marked turns, the triggering marker (one rubric check of that
 *   polarity) and the cited span, plus the Borderline (clarity) and
 *   Also question-form (multi-form) flags.
 *
 * Annotators only need to mark agreement/disagreement-form turns: "Finish
 * room" saves every undecided turn as Not marked and completes the room.
 * A marked turn without its check or cited span is "incomplete" and blocks
 * finishing.
 *
 * Every choice is saved immediately; the cited span is saved when the field
 * loses focus.  Shares the turn-list layout and styles of
 * ``QuestionAnalysisChatRoom``.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    projects as projectsApi,
    agreementAnalysis as agreementApi,
    waitForPendingWrites,
} from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import ErrorMessage from './ErrorMessage';
import './QuestionAnalysisChatRoom.css';
import './AgreementAnalysisChatRoom.css';

const parseApiError = (error) => {
    if (error.response?.data?.detail) return error.response.data.detail;
    return error.message || 'An unexpected error occurred';
};

/** Form decisions offered for every turn. */
const FORM_OPTIONS = [
    { value: 'agreement-form', label: 'Agreement-form' },
    { value: 'disagreement-form', label: 'Disagreement-form' },
    { value: 'none', label: 'Not marked' },
];

/** Rubric §4 checks per polarity; `value` matches the backend codes. */
const MARKER_CHECKS = {
    'agreement-form': [
        { value: 'agreement_verb', label: 'Agreement verb', examples: "I agree · I completely agree · I couldn't agree more" },
        { value: 'correctness_formula', label: 'Correctness formula', examples: "You're right · That's correct" },
        { value: 'truth_confirmation_formula', label: 'Truth-confirmation formula', examples: "That's true · Very true · So true" },
        { value: 'shared_position_formula', label: 'Shared-position formula', examples: 'I feel the same way · I share that view' },
    ],
    'disagreement-form': [
        { value: 'disagreement_verb', label: 'Disagreement verb', examples: "I disagree · I don't agree · I can't agree with that" },
        { value: 'incorrectness_formula', label: 'Incorrectness formula', examples: "You're wrong · That's not right · That's incorrect" },
        { value: 'falsity_formula', label: 'Falsity formula', examples: "That's not true · I don't think that's true · That's false" },
        { value: 'alternative_position_formula', label: 'Alternative-position formula', examples: "I see it differently · I don't share that view" },
    ],
};

const EMPTY_DRAFT = {
    form: null,
    marker_check: null,
    marker_span: '',
    borderline: false,
    multiform: false,
};

/** A decision is complete when it is "Not marked", or marked with its check and cited span. */
const isComplete = (annotation) =>
    annotation.form === 'none' || Boolean(annotation.marker_check && annotation.marker_span.trim());

/** Extract the reply-to turn id from a message, trying multiple field names. */
const getReplyTo = (msg) =>
    msg.reply_to_turn || msg.reply_to || msg.reply_to_id || null;

/** Text shown in the status chip of a collapsed turn. */
const CHIP_TEXT = { 'agreement-form': 'A', 'disagreement-form': 'D', none: '—' };

const AgreementAnalysisChatRoom = () => {
    const { projectId, roomId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    const [messages, setMessages] = useState([]);
    const [annotationsByMessage, setAnnotationsByMessage] = useState({});
    const [chatRoomName, setChatRoomName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [savingMessageId, setSavingMessageId] = useState(null);
    const [clearingMessageId, setClearingMessageId] = useState(null);
    const [showRubric, setShowRubric] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [showFinishConfirm, setShowFinishConfirm] = useState(false);
    const [isFinishing, setIsFinishing] = useState(false);
    const [isReopening, setIsReopening] = useState(false);

    // Hover / highlight interaction state
    const [highlightedUserId, setHighlightedUserId] = useState(null);
    const [replyHoverIds, setReplyHoverIds] = useState(null); // Set<number>

    // Accordion expand state — empty Set means all collapsed
    const [expandedIds, setExpandedIds] = useState(new Set());

    const [drafts, setDrafts] = useState({});

    /** Load the current annotator's decisions into `annotationsByMessage` and `drafts`. */
    const applyAnnotations = useCallback((rows) => {
        const byMessage = {};
        const nextDrafts = {};
        rows.forEach(row => {
            // Admins receive every annotator's rows; this view edits only one's own.
            if (row.annotator_id !== currentUser.id) return;
            byMessage[row.message_id] = row;
            nextDrafts[row.message_id] = {
                form: row.form,
                marker_check: row.marker_check,
                marker_span: row.marker_span || '',
                borderline: !!row.borderline,
                multiform: !!row.multiform,
            };
        });
        setAnnotationsByMessage(byMessage);
        setDrafts(nextDrafts);
    }, [currentUser.id]);

    const fetchData = useCallback(async () => {
        if (!projectId || !roomId) return;
        setLoading(true);
        setError(null);
        try {
            const [roomData, messagesResponse, rows, completionData] = await Promise.all([
                projectsApi.getChatRoom(projectId, roomId),
                projectsApi.getChatMessages(projectId, roomId),
                agreementApi.getChatRoomAnnotations(projectId, roomId),
                projectsApi.getChatRoomCompletion(projectId, roomId),
            ]);
            setChatRoomName(roomData?.name || '');
            setMessages(messagesResponse.messages || []);
            setIsCompleted(Boolean(completionData?.is_completed));
            applyAnnotations(rows || []);
        } catch (err) {
            setError(parseApiError(err));
        } finally {
            setLoading(false);
        }
    }, [projectId, roomId, applyAnnotations]);

    useEffect(() => { fetchData(); }, [fetchData]);

    /** Map turn_id → message.id for reply-hover resolution. */
    const turnIdToMsgId = useMemo(() => {
        const map = {};
        messages.forEach(m => { map[m.turn_id] = m.id; });
        return map;
    }, [messages]);

    // -------------------------------------------------------------------------
    // Interaction handlers
    // -------------------------------------------------------------------------

    /** Toggle persistent user highlight. Clears if same user clicked again. */
    const handleUserClick = (userId) => {
        setHighlightedUserId(prev => (prev === userId ? null : userId));
    };

    /** Highlight the hovered message + its reply target (if any). */
    const handleReplyHover = (currentMsgId, replyToTurnId) => {
        const targetId = turnIdToMsgId[replyToTurnId];
        if (!targetId) return;
        setReplyHoverIds(new Set([currentMsgId, targetId]));
    };

    const handleReplyHoverEnd = () => setReplyHoverIds(null);

    const toggleExpand = (msgId) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            next.has(msgId) ? next.delete(msgId) : next.add(msgId);
            return next;
        });
    };

    const expandAll = () => setExpandedIds(new Set(messages.map(m => m.id)));
    const collapseAll = () => setExpandedIds(new Set());
    const allExpanded = messages.length > 0 && expandedIds.size === messages.length;

    // -------------------------------------------------------------------------
    // Annotation handlers
    // -------------------------------------------------------------------------

    /** Update the local draft only (used while typing the cited span). */
    const updateDraft = (messageId, patch) => {
        setDrafts(prev => ({
            ...prev,
            [messageId]: { ...EMPTY_DRAFT, ...(prev[messageId] || {}), ...patch },
        }));
    };

    /** Persist a draft to the backend immediately. */
    const persistDraft = async (messageId, draft) => {
        setSavingMessageId(messageId);
        try {
            const saved = await agreementApi.upsertAnnotation(projectId, roomId, {
                message_id: messageId,
                form: draft.form,
                marker_check: draft.marker_check,
                marker_span: draft.marker_span,
                borderline: draft.borderline,
                multiform: draft.multiform,
            });
            setAnnotationsByMessage(prev => ({ ...prev, [messageId]: saved }));
        } catch (err) {
            setError(parseApiError(err));
        } finally {
            setSavingMessageId(null);
        }
    };

    /** Update the local draft and persist it right away (radios / checkboxes / buttons). */
    const updateAndPersist = (messageId, patch) => {
        const nextDraft = { ...EMPTY_DRAFT, ...(drafts[messageId] || {}), ...patch };
        setDrafts(prev => ({ ...prev, [messageId]: nextDraft }));
        persistDraft(messageId, nextDraft);
    };

    /**
     * Set the form decision.  "Not marked" clears the marker fields; switching
     * polarity clears the check, since checks belong to one polarity.
     */
    const setForm = (messageId, form) => {
        if (form === 'none') {
            updateAndPersist(messageId, { ...EMPTY_DRAFT, form: 'none' });
        } else if (form !== drafts[messageId]?.form) {
            updateAndPersist(messageId, { form, marker_check: null });
        }
    };

    /** Persist the cited span on blur, if it changed. */
    const persistSpan = (messageId) => {
        const draft = drafts[messageId];
        if (!draft || draft.form === 'none' || !draft.form) return;
        if (draft.marker_span.trim() === (annotationsByMessage[messageId]?.marker_span || '')) return;
        persistDraft(messageId, draft);
    };

    /** Copy the text selected inside this turn into the cited span. */
    const copySelectionToSpan = (messageId, turnText) => {
        const selection = window.getSelection()?.toString().trim();
        if (!selection || !turnText.includes(selection)) {
            setError('Select the marker text inside this turn first, then click "Use selected text".');
            return;
        }
        updateAndPersist(messageId, { marker_span: selection });
    };

    /** Delete the saved decision; the turn becomes undecided again. */
    const clearAnnotation = async (messageId) => {
        const saved = annotationsByMessage[messageId];
        if (!saved) return;
        setClearingMessageId(messageId);
        try {
            await agreementApi.deleteAnnotation(projectId, roomId, saved.id);
            setAnnotationsByMessage(prev => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
            setDrafts(prev => ({ ...prev, [messageId]: { ...EMPTY_DRAFT } }));
        } catch (err) {
            setError(parseApiError(err));
        } finally {
            setClearingMessageId(null);
        }
    };

    const savedAnnotations = Object.values(annotationsByMessage);
    const completeCount = savedAnnotations.filter(isComplete).length;
    const incompleteCount = savedAnnotations.length - completeCount;
    const totalCount = messages.length;
    const undecidedCount = totalCount - savedAnnotations.length;
    const percent = totalCount === 0 ? 0 : Math.round((completeCount / totalCount) * 100);

    /** Save undecided turns as Not marked and complete the room. */
    const finishRoom = async () => {
        setShowFinishConfirm(false);
        setIsFinishing(true);
        try {
            // A cited span saved on blur may still be in flight.
            await waitForPendingWrites();
            await agreementApi.finishRoom(projectId, roomId);
            applyAnnotations(await agreementApi.getChatRoomAnnotations(projectId, roomId));
            setIsCompleted(true);
        } catch (err) {
            setError(parseApiError(err));
        } finally {
            setIsFinishing(false);
        }
    };

    /** Mark the room as not completed again (decisions are kept). */
    const reopenRoom = async () => {
        setIsReopening(true);
        try {
            await projectsApi.updateChatRoomCompletion(projectId, roomId, false);
            setIsCompleted(false);
        } catch (err) {
            setError(parseApiError(err));
        } finally {
            setIsReopening(false);
        }
    };

    if (loading) {
        return <div className="qa-loading">Loading…</div>;
    }

    return (
        <div className="qa-chat-room">
            <header className="qa-header">
                <button className="qa-back" onClick={() => navigate(`/projects/${projectId}`)}>
                    ← Back
                </button>
                <div className="qa-title">
                    <h2>{chatRoomName || 'Agreement Analysis'}</h2>
                    <div className="qa-progress">
                        {completeCount}/{totalCount} decided ({percent}%)
                        {incompleteCount > 0 && (
                            <span className="aa-progress-warning"> · {incompleteCount} incomplete</span>
                        )}
                    </div>
                </div>
                <div className="qa-header-actions">
                    <button
                        type="button"
                        className="qa-help-btn"
                        onClick={allExpanded ? collapseAll : expandAll}
                    >
                        {allExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                    <button
                        type="button"
                        className="qa-help-btn"
                        onClick={() => setShowRubric(true)}
                    >
                        Rubric
                    </button>
                    {isCompleted ? (
                        <>
                            <span className="aa-finished-chip">Room finished</span>
                            <button
                                type="button"
                                className="qa-help-btn"
                                disabled={isReopening}
                                onClick={reopenRoom}
                            >
                                {isReopening ? 'Reopening…' : 'Reopen'}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="aa-finish-btn"
                            disabled={isFinishing || incompleteCount > 0}
                            title={incompleteCount > 0
                                ? 'Complete the marked turns first (check and cited span)'
                                : 'Save every undecided turn as Not marked and finish the room'}
                            onClick={() => setShowFinishConfirm(true)}
                        >
                            {isFinishing ? 'Finishing…' : 'Finish room'}
                        </button>
                    )}
                </div>
            </header>

            {error && (
                <Modal isOpen={!!error} onClose={() => setError(null)}>
                    <ErrorMessage message={error} onDismiss={() => setError(null)} />
                </Modal>
            )}

            {showFinishConfirm && (
                <Modal isOpen={showFinishConfirm} onClose={() => setShowFinishConfirm(false)}>
                    <div className="aa-confirm">
                        <h3>Finish room?</h3>
                        <p>
                            {undecidedCount === 0
                                ? 'Every turn already has a decision.'
                                : `${undecidedCount} turn${undecidedCount === 1 ? '' : 's'} without a decision will be saved as "Not marked".`}
                            {' '}The room will be marked as finished.
                        </p>
                        <div className="aa-confirm-actions">
                            <button type="button" className="qa-help-btn" onClick={() => setShowFinishConfirm(false)}>
                                Cancel
                            </button>
                            <button type="button" className="aa-finish-btn" onClick={finishRoom}>
                                Finish room
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {showRubric && (
                <Modal isOpen={showRubric} onClose={() => setShowRubric(false)}>
                    <div className="qa-rubric">
                        <h3>Agreement/disagreement-form rubric</h3>
                        <p>
                            Mark a turn only when <strong>its own wording explicitly displays agreement or
                            disagreement</strong>. If you must look at another turn to decide, do not mark it.
                        </p>
                        <p>
                            For each marked turn pick the <strong>triggering marker</strong> check, cite the exact
                            span (select it in the turn and click <em>Use selected text</em>), and set
                            {' '}<strong>Borderline</strong> when the form itself is partial or ambiguous and
                            {' '}<strong>Also question-form</strong> when the turn also carries question-form.
                        </p>
                        {Object.entries(MARKER_CHECKS).map(([form, checks]) => (
                            <div key={form}>
                                <p><strong>{form}</strong></p>
                                <ul>
                                    {checks.map((check) => (
                                        <li key={check.value}><strong>{check.label}</strong> — {check.examples}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        <p>
                            <strong>Do not mark:</strong> bare <em>yes / no / yeah / nope</em>; bare
                            {' '}<em>exactly / right / absolutely / definitely</em>; positive or negative assessments;
                            independent opinions; semantic compatibility or opposition between turns; epistemic
                            uncertainty (<em>maybe, I'm not sure</em>); reported agreement or disagreement.
                        </p>
                        <p>
                            You only need to mark agreement/disagreement-form turns: <strong>Finish room</strong>
                            {' '}saves every turn left without a decision as Not marked.
                        </p>
                        <button onClick={() => setShowRubric(false)}>Close</button>
                    </div>
                </Modal>
            )}

            <main className="qa-messages">
                {messages.map((msg) => {
                    const draft = drafts[msg.id] || { ...EMPTY_DRAFT };
                    const saved = annotationsByMessage[msg.id];
                    const savedComplete = saved ? isComplete(saved) : false;
                    const replyTo = getReplyTo(msg);
                    const isMarked = draft.form === 'agreement-form' || draft.form === 'disagreement-form';

                    const isExpanded = expandedIds.has(msg.id);
                    const isUserHighlighted = highlightedUserId === msg.user_id;
                    const isReplyLinked = replyHoverIds ? replyHoverIds.has(msg.id) : false;

                    const articleClass = [
                        'qa-message',
                        savedComplete ? 'qa-message-done' : '',
                        saved && !savedComplete ? 'aa-message-incomplete' : '',
                        isUserHighlighted ? 'qa-user-highlighted' : '',
                        isReplyLinked ? 'qa-reply-linked' : '',
                        !isExpanded ? 'qa-message-collapsed' : '',
                    ].filter(Boolean).join(' ');

                    return (
                        <article
                            key={msg.id}
                            className={articleClass}
                            data-message-id={msg.id}
                            onClick={!isExpanded ? () => toggleExpand(msg.id) : undefined}
                        >
                            <header className="qa-message-header">
                                <span className="qa-turn-id">{msg.turn_id}</span>
                                <span
                                    className={`qa-user-id ${isUserHighlighted ? 'qa-user-id-active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); handleUserClick(msg.user_id); }}
                                    title="Click to highlight all turns by this user"
                                >
                                    {msg.user_id}
                                </span>
                                {replyTo && (
                                    <span
                                        className="qa-reply-indicator"
                                        onMouseEnter={() => handleReplyHover(msg.id, replyTo)}
                                        onMouseLeave={handleReplyHoverEnd}
                                        title={`Replies to turn ${replyTo}`}
                                    >
                                        ↪ {replyTo}
                                    </span>
                                )}
                                {saved && !savedComplete && (
                                    <span className="aa-incomplete-chip">Incomplete</span>
                                )}
                                {!isExpanded && saved && (
                                    <span className="qa-status-chip">{CHIP_TEXT[saved.form]}</span>
                                )}
                                {!isExpanded && !saved && (
                                    <span className="qa-status-dot" />
                                )}
                                <button
                                    type="button"
                                    className="qa-toggle-btn"
                                    onClick={(e) => { e.stopPropagation(); toggleExpand(msg.id); }}
                                    title={isExpanded ? 'Collapse' : 'Expand'}
                                >
                                    {isExpanded ? '⌃' : '⌄'}
                                </button>
                            </header>
                            <p className="qa-message-text">{msg.turn_text}</p>

                            {isExpanded && <div className="qa-controls" onClick={(e) => e.stopPropagation()}>
                                <div className="aa-form-options" role="radiogroup" aria-label="Form">
                                    {FORM_OPTIONS.map((option) => (
                                        <label key={option.value}>
                                            <input
                                                type="radio"
                                                name={`form-${msg.id}`}
                                                checked={draft.form === option.value}
                                                onChange={() => setForm(msg.id, option.value)}
                                            />
                                            {option.label}
                                        </label>
                                    ))}
                                </div>

                                {isMarked && (
                                    <>
                                        <fieldset className="aa-marker-checks">
                                            <legend>Triggering marker</legend>
                                            {MARKER_CHECKS[draft.form].map((check) => (
                                                <label key={check.value} title={check.examples}>
                                                    <input
                                                        type="radio"
                                                        name={`marker-${msg.id}`}
                                                        checked={draft.marker_check === check.value}
                                                        onChange={() => updateAndPersist(msg.id, { marker_check: check.value })}
                                                    />
                                                    {check.label}
                                                    <span className="aa-check-examples">{check.examples}</span>
                                                </label>
                                            ))}
                                        </fieldset>

                                        <div className="aa-span-field">
                                            <label>
                                                <span>Cited span</span>
                                                <input
                                                    type="text"
                                                    value={draft.marker_span}
                                                    maxLength={300}
                                                    onChange={(e) => updateDraft(msg.id, { marker_span: e.target.value })}
                                                    onBlur={() => persistSpan(msg.id)}
                                                    placeholder="e.g. I completely agree"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                className="qa-help-btn"
                                                // Keep the text selection from being cleared by the click.
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => copySelectionToSpan(msg.id, msg.turn_text)}
                                            >
                                                Use selected text
                                            </button>
                                        </div>

                                        <div className="qa-flags">
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={!!draft.borderline}
                                                    onChange={(e) => updateAndPersist(msg.id, { borderline: e.target.checked })}
                                                />
                                                Borderline
                                            </label>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={!!draft.multiform}
                                                    onChange={(e) => updateAndPersist(msg.id, { multiform: e.target.checked })}
                                                />
                                                Also question-form
                                            </label>
                                        </div>
                                    </>
                                )}

                                <div className="qa-actions">
                                    {savingMessageId === msg.id && <span className="qa-saving">Saving…</span>}
                                    {saved && (
                                        <button
                                            type="button"
                                            className="qa-clear"
                                            disabled={clearingMessageId === msg.id}
                                            onClick={() => clearAnnotation(msg.id)}
                                        >
                                            {clearingMessageId === msg.id ? 'Clearing…' : 'Clear'}
                                        </button>
                                    )}
                                </div>
                            </div>}
                        </article>
                    );
                })}
            </main>
        </div>
    );
};

export default AgreementAnalysisChatRoom;
