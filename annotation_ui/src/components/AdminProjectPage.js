/**
 * @fileoverview Admin project management page.
 *
 * Provides the full administrative interface for a single project, including:
 *
 * - **Project metadata**: inline description editing; relation-type management
 *   with drag-to-reorder, add, remove, and alphabetic sort.
 * - **User management**: assign annotators from the full user list; remove
 *   them from the project with confirmation.
 * - **Chat room import**: select one or many CSV files (one room per file,
 *   named after the file).  Files are checked locally, can be validated on
 *   the server, and are imported in request-sized batches with per-file
 *   results; any file's first 20 rows can be previewed.
 * - **Chat room list**: per-room IAA status badges (Complete / Partial /
 *   NotEnoughData / Error); navigate to the admin chat-room view; rename or
 *   delete with confirmation.
 * - **Export**: disentanglement rooms export directly (with confirmation if
 *   data is partial); adjacency-pairs rooms open an annotator-picker modal
 *   to download per-annotator `.txt` or full-room `.zip` archives.
 * - **IAA analytics**: fetched via `getChatRoomIAA` for each room on load;
 *   stored in `chatRoomAnalytics` keyed by room ID.
 *
 * Destructive actions (delete project, delete chat room, remove user) all go
 * through the shared `ConfirmationModal` to prevent accidental data loss.
 * Errors from any async operation are surfaced via the `ErrorMessage`
 * component at the top of the page and via the `warningMessage` router state
 * passed from `AdminChatRoomView`.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { projects as projectsApi, users as usersApi, annotations as annotationsApi, adjacencyPairs as adjacencyPairsApi, questionAnalysis as questionAnalysisApi, agreementAnalysis as agreementAnalysisApi } from '../utils/api';
import ErrorMessage from './ErrorMessage';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_IMPORT_LIMITS, checkSelection, chunkFiles, roomNameFromFilename } from '../utils/batchImport';
import './AdminProjectPage.css';

/**
 * Full admin management page for a single project.
 */
const AdminProjectPage = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { addToast } = useToast();

    const [project, setProject] = useState(null);
    const [assignedUsers, setAssignedUsers] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [chatRooms, setChatRooms] = useState([]);
    const [chatRoomAnalytics, setChatRoomAnalytics] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [importError, setImportError] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [importPreview, setImportPreview] = useState(null);
    // One entry per selected CSV; see handleFileSelect for its fields.
    const [importItems, setImportItems] = useState([]);
    const [importLimits, setImportLimits] = useState(DEFAULT_IMPORT_LIMITS);
    const [importProgress, setImportProgress] = useState(null); // { label, done, total }
    const importKeyCounter = useRef(0);
    const [isAssigning, setIsAssigning] = useState(false);
    const [userToAssign, setUserToAssign] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [relationTypes, setRelationTypes] = useState([]);
    const [relationTypeInput, setRelationTypeInput] = useState('');
    const [isUpdatingProject, setIsUpdatingProject] = useState(false);
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const [dragIndex, setDragIndex] = useState(null);
    const [exportModal, setExportModal] = useState({ visible: false, roomId: null, roomName: '' });
    const [exportAnnotatorId, setExportAnnotatorId] = useState('all');
    const [editChatRoomModal, setEditChatRoomModal] = useState({ open: false, roomId: null, name: '' });
    const [isRenamingChatRoom, setIsRenamingChatRoom] = useState(false);

    // ── Confirmation modal state ──────────────────────────────────────────────
    const [confirmModal, setConfirmModal] = useState({
        open: false, title: '', message: '', confirmText: 'Confirm',
        type: 'danger', onConfirm: null
    });

    /**
     * Open the shared confirmation modal with a custom action callback.
     * @param {string} title
     * @param {string} message
     * @param {Function} onConfirm - Async action to run when the user confirms.
     * @param {{type?: string, confirmText?: string}} [options]
     */
    const openConfirm = (title, message, onConfirm, { type = 'danger', confirmText = 'Confirm' } = {}) => {
        setConfirmModal({ open: true, title, message, confirmText, type, onConfirm });
    };
    const closeConfirm = () => setConfirmModal(prev => ({ ...prev, open: false, onConfirm: null }));

    // ── Data fetching ─────────────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [projectData, assignedUsersData, allUsersData, chatRoomsData] = await Promise.all([
                projectsApi.getProject(projectId),
                projectsApi.getProjectUsers(projectId),
                usersApi.getUsers(),
                projectsApi.getChatRooms(projectId)
            ]);
            setProject(projectData);
            setRelationTypes(projectData.relation_types || []);
            setDescriptionDraft(projectData.description || '');
            setAssignedUsers(assignedUsersData);
            setAllUsers(allUsersData);
            setChatRooms(chatRoomsData);
            await fetchChatRoomAnalytics(chatRoomsData, projectData);
        } catch (err) {
            console.error('Failed to fetch project admin data:', err);
            setError(err.response?.data?.detail || 'Failed to load project data.');
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    /**
     * Fetch IAA data for every chat room and populate `chatRoomAnalytics`.
     *
     * Errors per room are caught individually so a single failing room does not
     * block the entire analytics load; failed rooms receive an `'Error'` status.
     * @param {Object[]} rooms - Chat room list.
     * @param {Object} projectData - Project record (used to select the IAA formula).
     */
    const fetchChatRoomAnalytics = async (rooms, projectData) => {
        const analytics = {};

        for (const room of rooms) {
            try {
                const iaaData = await annotationsApi.getChatRoomIAA(room.id);
                if (projectData?.annotation_type === 'adjacency_pairs') {
                    analytics[room.id] = {
                        status: iaaData.analysis_status,
                        completedAnnotators: iaaData.completed_annotators.length,
                        totalAnnotators: iaaData.total_annotators_assigned,
                        averageAgreement: calculateAverageAdjIAA(iaaData.pairwise_adj_iaa),
                        canAnalyze: iaaData.total_annotators_assigned > 0,
                    };
                } else if (projectData?.annotation_type === 'question_analysis') {
                    analytics[room.id] = {
                        status: iaaData.analysis_status,
                        completedAnnotators: iaaData.completed_annotators.length,
                        totalAnnotators: iaaData.total_annotators_assigned,
                        averageAgreement: calculateAverageQuestionAnalysisIAA(iaaData.pairwise_question_analysis_iaa),
                        canAnalyze: iaaData.total_annotators_assigned > 0,
                    };
                } else if (projectData?.annotation_type === 'agreement_analysis') {
                    analytics[room.id] = {
                        status: iaaData.analysis_status,
                        completedAnnotators: iaaData.completed_annotators.length,
                        totalAnnotators: iaaData.total_annotators_assigned,
                        // Same 0–100 combined_iaa scale as question analysis.
                        averageAgreement: calculateAverageQuestionAnalysisIAA(iaaData.pairwise_agreement_analysis_iaa),
                        canAnalyze: iaaData.total_annotators_assigned > 0,
                    };
                } else {
                    analytics[room.id] = {
                        status: iaaData.analysis_status,
                        completedAnnotators: iaaData.completed_annotators.length,
                        totalAnnotators: iaaData.total_annotators_assigned,
                        averageAgreement: calculateAverageAgreement(iaaData.pairwise_accuracies),
                        canAnalyze: iaaData.total_annotators_assigned > 0,
                    };
                }
            } catch {
                analytics[room.id] = { status: 'Error', completedAnnotators: 0, totalAnnotators: 0, averageAgreement: null, canAnalyze: false };
            }
        }
        setChatRoomAnalytics(analytics);
    };

    /**
     * Compute the mean accuracy across all pairwise annotator combinations for
     * disentanglement projects.
     * @param {Object[]} pairwiseAccuracies
     * @returns {string|null} Fixed-1 decimal string, or `null` if no data.
     */
    const calculateAverageAgreement = (pairwiseAccuracies) => {
        if (!pairwiseAccuracies || pairwiseAccuracies.length === 0) return null;
        const sum = pairwiseAccuracies.reduce((acc, pair) => acc + pair.accuracy, 0);
        return (sum / pairwiseAccuracies.length).toFixed(1);
    };

    /**
     * Compute the mean combined IAA across all pairwise combinations for
     * adjacency-pairs projects.
     * @param {Object[]} pairwiseAdjIAA - Each entry must have a `combined_iaa` field.
     * @returns {string|null} Fixed-3 decimal string, or `null` if no data.
     */
    const calculateAverageAdjIAA = (pairwiseAdjIAA) => {
        if (!pairwiseAdjIAA || pairwiseAdjIAA.length === 0) return null;
        const sum = pairwiseAdjIAA.reduce((acc, pair) => acc + pair.combined_iaa, 0);
        return (sum / pairwiseAdjIAA.length).toFixed(3);
    };

    /**
     * Compute the mean combined IAA across all pairwise combinations for
     * question-analysis projects (already expressed as 0–100).
     * @param {Object[]} pairwiseQuestionAnalysisIAA - Each entry must have a `combined_iaa` field.
     */
    const calculateAverageQuestionAnalysisIAA = (pairwiseQuestionAnalysisIAA) => {
        if (!pairwiseQuestionAnalysisIAA || pairwiseQuestionAnalysisIAA.length === 0) return null;
        const sum = pairwiseQuestionAnalysisIAA.reduce((acc, pair) => acc + pair.combined_iaa, 0);
        return (sum / pairwiseQuestionAnalysisIAA.length).toFixed(1);
    };

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        projectsApi.getImportLimits()
            .then(setImportLimits)
            .catch(() => { /* keep the defaults; the server still enforces its limits */ });
    }, []);

    useEffect(() => {
        const removeChatRoomId = location.state?.removeChatRoomId;
        const warningMessage = location.state?.warningMessage;
        if (removeChatRoomId) removeChatRoomFromList(removeChatRoomId);
        if (warningMessage) setError(warningMessage);
        if (removeChatRoomId || warningMessage) navigate(location.pathname, { replace: true, state: {} });
    }, [location.state, location.pathname, navigate]);

    // ── User management ───────────────────────────────────────────────────────
    const handleRemoveUser = (userId, username) => {
        openConfirm(
            'Remove User',
            `Remove "${username}" from this project?`,
            async () => {
                try {
                    await projectsApi.removeUser(projectId, userId);
                    fetchData();
                    addToast(`User "${username}" removed from project.`, 'success');
                } catch (err) {
                    setError(err.response?.data?.detail || 'Failed to remove user.');
                }
            }
        );
    };

    const handleAssignUser = async (e) => {
        e.preventDefault();
        if (!userToAssign) { setError('Please select a user to assign.'); return; }
        try {
            await projectsApi.assignUser(projectId, userToAssign);
            setUserToAssign('');
            setIsAssigning(false);
            fetchData();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to assign user.');
        }
    };

    // ── CSV import ────────────────────────────────────────────────────────────
    /**
     * Status shown for a selected file.  A server result wins once the room is
     * created; otherwise a local problem (not a CSV, too large, name taken or
     * repeated) wins over the last server check.
     */
    const importItemStatus = (item) => {
        if (item.serverStatus === 'created') return 'created';
        if (item.localProblem) return 'invalid';
        return item.serverStatus || 'ready';
    };

    /** Re-run the local checks over the files that are not imported yet. */
    const recheckImportItems = useCallback((items) => {
        const open = items.filter((item) => item.serverStatus !== 'created');
        const problems = checkSelection(open.map((item) => item.file), chatRooms.map((room) => room.name), importLimits);
        const problemByKey = new Map(open.map((item, i) => [item.key, problems[i]]));
        return items.map((item) => (
            item.serverStatus === 'created' ? item : { ...item, localProblem: problemByKey.get(item.key) }
        ));
    }, [chatRooms, importLimits]);

    // Re-check the selection when the project's rooms or the server limits change
    // (after an import, a rename or delete, or once the limits have loaded).
    useEffect(() => {
        setImportItems((items) => (items.length ? recheckImportItems(items) : items));
    }, [recheckImportItems]);

    const handleFileSelect = (e) => {
        const added = Array.from(e.target.files || []).map((file) => ({
            key: `import-${importKeyCounter.current++}`,
            file,
            roomName: roomNameFromFilename(file.name),
            localProblem: null,
            serverStatus: null, // 'valid' | 'invalid' | 'created' | 'failed'
            serverMessage: null,
            totalRows: null,
            warnings: [],
        }));
        // Allow picking the same files again after removing them.
        e.target.value = '';
        if (added.length === 0) return;
        setImportItems((items) => recheckImportItems([...items, ...added]));
        setImportError(null);
        setPreviewError(null);
    };

    const handleRemoveImportItem = (key) => {
        setImportItems((items) => recheckImportItems(items.filter((item) => item.key !== key)));
        setImportPreview((preview) => (preview?.key === key ? null : preview));
    };

    const handleClearImportItems = () => {
        setImportItems([]);
        setImportPreview(null);
        setImportError(null);
        setPreviewError(null);
    };

    /** Record per-file server results for the items with the given keys (same order). */
    const applyBatchResults = (keys, results, successStatus, failureStatus) => {
        const byKey = new Map(keys.map((key, i) => [key, results[i]]));
        setImportItems((items) => items.map((item) => {
            const result = byKey.get(item.key);
            if (!result) return item;
            const ok = result.status === 'ok' || result.status === 'created';
            return {
                ...item,
                serverStatus: ok ? successStatus : failureStatus,
                serverMessage: ok ? null : result.error,
                totalRows: result.total_rows ?? item.totalRows,
                warnings: result.warnings || [],
            };
        }));
    };

    /**
     * Send `items` to `request` in chunks that respect the server limits,
     * reporting progress.  A chunk whose whole request fails marks its files
     * and the next chunk is still sent.
     * @returns {Promise<number>} How many files the server accepted.
     */
    const runInChunks = async (items, label, request, successStatus, failureStatus) => {
        const byFile = new Map(items.map((item) => [item.file, item]));
        const chunks = chunkFiles(items.map((item) => item.file), importLimits);
        let done = 0;
        let succeeded = 0;
        setImportProgress({ label, done, total: items.length });
        for (const chunk of chunks) {
            const keys = chunk.map((file) => byFile.get(file).key);
            try {
                const response = await request(chunk);
                succeeded += response.succeeded;
                applyBatchResults(keys, response.results, successStatus, failureStatus);
            } catch (err) {
                applyBatchResults(keys, chunk.map(() => ({ status: 'failed', error: err.message })), successStatus, failureStatus);
            }
            done += chunk.length;
            setImportProgress({ label, done, total: items.length });
        }
        setImportProgress(null);
        return succeeded;
    };

    const pendingImportItems = () => importItems.filter((item) => {
        const status = importItemStatus(item);
        return status === 'ready' || status === 'valid' || status === 'failed';
    });

    const handleValidateCsvs = async () => {
        const pending = pendingImportItems();
        if (pending.length === 0) return;
        setIsPreviewing(true);
        setPreviewError(null);
        try {
            await runInChunks(pending, 'Validating', (files) => projectsApi.previewImportCsvBatch(projectId, files), 'valid', 'invalid');
        } finally {
            setIsPreviewing(false);
        }
    };

    const handlePreviewRows = async (item) => {
        setIsPreviewing(true);
        setPreviewError(null);
        try {
            const preview = await projectsApi.previewImportCsv(projectId, item.file, 20);
            setImportPreview({ ...preview, key: item.key, filename: item.file.name });
        } catch (err) {
            setPreviewError(`${item.file.name}: ${err.message || 'Failed to preview CSV.'}`);
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleUploadCsvs = async () => {
        // Files the server already rejected in a validation are not resent.
        const pending = pendingImportItems().filter((item) => item.serverStatus !== 'invalid');
        if (pending.length === 0) { setImportError('There are no files ready to import.'); return; }
        setIsUploading(true);
        setImportError(null);
        let created = 0;
        try {
            created = await runInChunks(pending, 'Importing', (files) => projectsApi.importCsvBatch(projectId, files), 'created', 'failed');
        } finally {
            setIsUploading(false);
        }
        const failed = pending.length - created;
        if (created > 0) {
            addToast(`${created} chat room${created === 1 ? '' : 's'} imported${failed ? `, ${failed} failed` : ''}.`, failed ? 'warning' : 'success');
            fetchData();
        } else {
            setImportError(`None of the ${failed} file${failed === 1 ? '' : 's'} could be imported; see the list for the reason.`);
        }
    };

    const importCounts = importItems.reduce((counts, item) => {
        const status = importItemStatus(item);
        counts[status] = (counts[status] || 0) + 1;
        return counts;
    }, {});
    const importableCount = importItems.filter((item) => {
        const status = importItemStatus(item);
        return status === 'ready' || status === 'valid' || status === 'failed';
    }).length;
    const importBusy = isUploading || isPreviewing;
    const importStatusLabel = {
        ready: { class: 'status-unknown', text: 'Ready' },
        valid: { class: 'status-complete', text: 'Valid' },
        invalid: { class: 'status-error', text: 'Cannot import' },
        created: { class: 'status-complete', text: 'Imported' },
        failed: { class: 'status-error', text: 'Failed' },
    };

    // ── Project management ────────────────────────────────────────────────────
    const handleDeleteProject = () => {
        openConfirm(
            'Delete Project',
            `Permanently delete "${project?.name}"? This removes all chat rooms, turns, and annotations and cannot be undone.`,
            async () => {
                try {
                    await projectsApi.deleteProject(projectId);
                    addToast('Project deleted successfully.', 'success');
                    navigate('/admin');
                } catch (err) {
                    setError(err.response?.data?.detail || 'Failed to delete project.');
                }
            },
            { confirmText: 'Delete Project' }
        );
    };

    /**
     * Persist an updated `relation_types` array to the backend and sync local
     * state.  Called after every add, remove, sort, or drag-reorder operation.
     * @param {string[]} nextTypes
     */
    const handleUpdateRelationTypes = async (nextTypes) => {
        if (!project) return;
        setIsUpdatingProject(true);
        try {
            const updated = await projectsApi.updateProject(projectId, { relation_types: nextTypes });
            setProject(updated);
            setRelationTypes(updated.relation_types || []);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to update project.');
        } finally {
            setIsUpdatingProject(false);
        }
    };

    const handleAddRelationType = (e) => {
        e.preventDefault();
        const value = relationTypeInput.trim();
        if (!value || relationTypes.includes(value)) return;
        const nextTypes = [...relationTypes, value];
        setRelationTypes(nextTypes);
        handleUpdateRelationTypes(nextTypes);
        setRelationTypeInput('');
    };

    const handleRemoveRelationType = (value) => {
        const nextTypes = relationTypes.filter(item => item !== value);
        setRelationTypes(nextTypes);
        handleUpdateRelationTypes(nextTypes);
    };

    const handleSortRelationTypes = () => {
        const nextTypes = [...relationTypes].sort((a, b) => a.localeCompare(b));
        setRelationTypes(nextTypes);
        handleUpdateRelationTypes(nextTypes);
    };

    const handleDragStart = (index) => setDragIndex(index);
    const handleDrop = (index) => {
        if (dragIndex === null || dragIndex === index) return;
        const next = [...relationTypes];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        setRelationTypes(next);
        handleUpdateRelationTypes(next);
        setDragIndex(null);
    };

    const handleUpdateDescription = async () => {
        if (!project) return;
        setIsUpdatingProject(true);
        try {
            const updated = await projectsApi.updateProject(projectId, { description: descriptionDraft });
            setProject(updated);
            setIsEditingDescription(false);
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to update project.');
        } finally {
            setIsUpdatingProject(false);
        }
    };

    // ── Export ────────────────────────────────────────────────────────────────
    /**
     * Trigger export for a chat room.
     *
     * For adjacency-pairs projects, opens an annotator-picker modal.
     * For disentanglement projects, exports directly but intercepts `'Partial'`
     * and `'NotEnoughData'` statuses with confirmation modals before proceeding.
     *
     * @param {number} chatRoomId
     * @param {string} chatRoomName
     * @param {Object} analytics - IAA analytics record for this room (used for
     *   status-gated confirmations).
     */
    const handleExportChatRoom = async (chatRoomId, chatRoomName, analytics) => {
        setError(null);

        if (project.annotation_type === 'adjacency_pairs') {
            setExportAnnotatorId('all');
            setExportModal({ visible: true, roomId: chatRoomId, roomName: chatRoomName });
            return;
        }

        if (project.annotation_type === 'question_analysis') {
            const doExportQA = async () => {
                await questionAnalysisApi.exportChatRoomJson(chatRoomId);
                const label = analytics?.status === 'Complete' ? 'Complete'
                    : analytics?.status === 'Partial' ? 'Partial' : 'Insufficient';
                addToast(`Question-analysis data exported (${label}).`,
                    analytics?.status === 'Complete' ? 'success' : 'warning');
            };

            if (analytics?.status === 'Partial') {
                openConfirm(
                    'Export Partial Data',
                    `This chat room is only partially annotated (${analytics.completedAnnotators}/${analytics.totalAnnotators} annotators completed). Proceed?`,
                    doExportQA,
                    { type: 'warning', confirmText: 'Export Anyway' }
                );
            } else if (analytics?.status === 'NotEnoughData') {
                openConfirm(
                    'Export Insufficient Data',
                    'This chat room has insufficient annotation data (less than 2 completed annotators). Proceed?',
                    doExportQA,
                    { type: 'warning', confirmText: 'Export Anyway' }
                );
            } else {
                try { await doExportQA(); } catch (err) { setError(err.message || 'Failed to export question-analysis data.'); }
            }
            return;
        }

        if (project.annotation_type === 'agreement_analysis') {
            const doExportAgreement = async () => {
                await agreementAnalysisApi.exportChatRoomJson(chatRoomId);
                const label = analytics?.status === 'Complete' ? 'Complete'
                    : analytics?.status === 'Partial' ? 'Partial' : 'Insufficient';
                addToast(`Agreement-analysis data exported (${label}).`,
                    analytics?.status === 'Complete' ? 'success' : 'warning');
            };

            if (analytics?.status === 'Partial') {
                openConfirm(
                    'Export Partial Data',
                    `This chat room is only partially annotated (${analytics.completedAnnotators}/${analytics.totalAnnotators} annotators finished). Proceed?`,
                    doExportAgreement,
                    { type: 'warning', confirmText: 'Export Anyway' }
                );
            } else if (analytics?.status === 'NotEnoughData') {
                openConfirm(
                    'Export Insufficient Data',
                    'This chat room has insufficient annotation data (less than 2 annotators finished). Proceed?',
                    doExportAgreement,
                    { type: 'warning', confirmText: 'Export Anyway' }
                );
            } else {
                try { await doExportAgreement(); } catch (err) { setError(err.message || 'Failed to export agreement-analysis data.'); }
            }
            return;
        }

        const doExport = async () => {
            await annotationsApi.exportChatRoom(chatRoomId);
            const label = analytics.status === 'Complete' ? 'Complete' : analytics.status === 'Partial' ? 'Partial' : 'Insufficient';
            addToast(`${label} annotation data exported successfully.`, analytics.status === 'Complete' ? 'success' : 'warning');
        };

        if (analytics.status === 'Partial') {
            openConfirm(
                'Export Partial Data',
                `This chat room is only partially annotated (${analytics.completedAnnotators}/${analytics.totalAnnotators} annotators completed). The exported data will be marked as PARTIAL. Proceed?`,
                doExport,
                { type: 'warning', confirmText: 'Export Anyway' }
            );
        } else if (analytics.status === 'NotEnoughData') {
            openConfirm(
                'Export Insufficient Data',
                `This chat room has insufficient annotation data (less than 2 completed annotators). The data is not suitable for analysis. Proceed?`,
                doExport,
                { type: 'warning', confirmText: 'Export Anyway' }
            );
        } else {
            try { await doExport(); } catch (err) { setError(err.message || 'Failed to export chat room data.'); }
        }
    };

    /**
     * Download the agreement-analysis record table (marked turns only) as a
     * ZIP with one CSV per assigned annotator.
     * @param {number} chatRoomId
     */
    const handleExportAgreementCsv = async (chatRoomId) => {
        setError(null);
        try {
            await agreementAnalysisApi.exportChatRoomCsv(chatRoomId);
            addToast('Agreement-analysis CSV exported (one file per annotator).', 'success');
        } catch (err) {
            setError(err.message || 'Failed to export agreement-analysis CSV.');
        }
    };

    /**
     * Execute the adjacency-pairs export from the modal.
     *
     * When `exportAnnotatorId` is `'all'`, exports a `.zip` containing all
     * annotators; otherwise exports a single annotator's `.txt` file.  The
     * filename is derived from the room name and annotator username.
     */
    const handleExportAdjacencyPairs = async () => {
        if (!exportModal.roomId) return;
        try {
            const annotatorId = exportAnnotatorId === 'all' ? null : parseInt(exportAnnotatorId, 10);
            const safeRoomName = (exportModal.roomName || `chat_room_${exportModal.roomId}`).replace(/\s+/g, '-');
            let filenameOverride = null;
            if (annotatorId == null) {
                filenameOverride = `${safeRoomName}-all.zip`;
            } else {
                const user = assignedUsers.find(u => u.id === annotatorId);
                const username = user?.username || `user_${annotatorId}`;
                filenameOverride = `${safeRoomName}-${username.replace(/\s+/g, '-')}.txt`;
            }
            await adjacencyPairsApi.exportChatRoomPairs(exportModal.roomId, annotatorId, filenameOverride);
            setExportModal({ visible: false, roomId: null, roomName: '' });
        } catch (err) {
            setError(err.message || 'Failed to export adjacency pairs.');
        }
    };

    // ── Chat room management ──────────────────────────────────────────────────
    /**
     * Remove a chat room from the local UI lists without a round-trip to the
     * backend.  Used when navigation to a room reveals it no longer exists.
     * @param {number} chatRoomId
     */
    const removeChatRoomFromList = (chatRoomId) => {
        setChatRooms(prev => prev.filter(room => room.id !== chatRoomId));
        setChatRoomAnalytics(prev => { const updated = { ...prev }; delete updated[chatRoomId]; return updated; });
    };

    /**
     * Navigate to the admin chat-room view, first verifying the room still
     * exists.  Removes the room from the local list and shows an error if the
     * GET request fails (e.g., room was deleted externally).
     * @param {number} chatRoomId
     */
    const handleViewChatRoom = async (chatRoomId) => {
        try {
            await projectsApi.getChatRoom(projectId, chatRoomId);
            navigate(`/admin/projects/${projectId}/chat-rooms/${chatRoomId}`);
        } catch (err) {
            removeChatRoomFromList(chatRoomId);
            setError(err.response?.data?.detail || 'Failed to load chat room. It was removed from the list.');
        }
    };

    const handleDeleteChatRoom = (chatRoomId, chatRoomName) => {
        openConfirm(
            'Delete Chat Room',
            `Delete "${chatRoomName}"? This will permanently remove all messages and annotations in this room.`,
            async () => {
                try {
                    setError(null);
                    await projectsApi.deleteChatRoom(chatRoomId);
                    addToast(`Chat room "${chatRoomName}" deleted.`, 'success');
                    fetchData();
                } catch (err) {
                    setError(err.response?.data?.detail || 'Failed to delete chat room.');
                }
            },
            { confirmText: 'Delete Chat Room' }
        );
    };

    const handleOpenRenameChatRoom = (room) => {
        setEditChatRoomModal({ open: true, roomId: room.id, name: room.name || '' });
    };

    const handleRenameChatRoom = async () => {
        if (!editChatRoomModal.roomId) return;
        const nextName = editChatRoomModal.name.trim();
        if (!nextName) { setError('Chat room name cannot be empty.'); return; }
        setIsRenamingChatRoom(true);
        try {
            const updated = await projectsApi.updateChatRoom(editChatRoomModal.roomId, { name: nextName });
            setChatRooms(prev => prev.map(room => room.id === updated.id ? { ...room, name: updated.name } : room));
            setEditChatRoomModal({ open: false, roomId: null, name: '' });
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to rename chat room.');
        } finally {
            setIsRenamingChatRoom(false);
        }
    };

    // ── Status badge ──────────────────────────────────────────────────────────
    /**
     * Render a coloured status badge for a chat room's IAA analysis state.
     * @param {string} status - One of: 'Completed', 'Started', 'NotStarted',
     *   'Complete', 'Partial', 'NotEnoughData', 'Error', 'N/A'.
     * @returns {React.ReactElement}
     */
    const getStatusBadge = (status) => {
        const badges = {
            'Completed': { class: 'status-complete', text: 'Completed' },
            'Started': { class: 'status-partial', text: 'Started' },
            'NotStarted': { class: 'status-unknown', text: 'Not Started' },
            'Complete': { class: 'status-complete', text: 'Annotated' },
            'Partial': { class: 'status-partial', text: 'In Progress' },
            'InProgress': { class: 'status-partial', text: 'In Progress' },
            'NotEnoughData': { class: 'status-insufficient', text: 'Insufficient Data' },
            'Error': { class: 'status-error', text: 'Error' },
            'N/A': { class: 'status-unknown', text: 'N/A' }
        };
        const badge = badges[status] || { class: 'status-unknown', text: 'Unknown' };
        return <span className={`status-badge ${badge.class}`}>{badge.text}</span>;
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    if (loading) return <div className="loading-container">Loading project details...</div>;
    if (!project) return <div>Project not found.</div>;

    const availableUsersToAssign = allUsers.filter(u => !assignedUsers.some(a => a.id === u.id));

    return (
        <div className="admin-project-page">
            {/* Confirmation modal (replaces window.confirm) */}
            <ConfirmationModal
                isOpen={confirmModal.open}
                onClose={closeConfirm}
                onConfirm={() => { confirmModal.onConfirm?.(); closeConfirm(); }}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmText={confirmModal.confirmText}
                type={confirmModal.type}
            />

            <header className="page-header">
                <button onClick={() => navigate('/admin')} className="back-button">Back to Dashboard</button>
                <h1>Manage Project<br /><span className="project-name">{project.name}</span></h1>
            </header>

            {/* Description */}
            <div className="management-section">
                <div className="section-header">
                    <h2>Project Description</h2>
                    {!isEditingDescription && (
                        <button className="icon-button" onClick={() => setIsEditingDescription(true)} title="Edit description">Edit</button>
                    )}
                </div>
                {!isEditingDescription ? (
                    <p className="project-description">{project.description || 'No description'}</p>
                ) : (
                    <div className="project-description-edit">
                        <textarea value={descriptionDraft} onChange={e => setDescriptionDraft(e.target.value)} rows={3} />
                        <div className="description-actions">
                            <button className="action-button" onClick={handleUpdateDescription} disabled={isUpdatingProject}>Save</button>
                            <button className="action-button secondary" onClick={() => { setDescriptionDraft(project.description || ''); setIsEditingDescription(false); }}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>

            {error && <ErrorMessage type="warning" title="Warning" message={error} />}

            {/* Settings */}
            <div className="management-section">
                <div className="section-header"><h2>Project Settings</h2></div>
                <div className="settings-grid">
                    <div><strong>Annotation Type:</strong> {
                        project.annotation_type === 'adjacency_pairs' ? 'Adjacency Pairs'
                        : project.annotation_type === 'question_analysis' ? 'Question Analysis'
                        : project.annotation_type === 'agreement_analysis' ? 'Agreement Analysis'
                        : 'Chat Disentanglement'
                    }</div>
                </div>
                {project.annotation_type === 'adjacency_pairs' && (
                    <div className="relation-types-editor">
                        <label>Relation Types</label>
                        <form onSubmit={handleAddRelationType} className="relation-input-row">
                            <input type="text" value={relationTypeInput} onChange={e => setRelationTypeInput(e.target.value)} placeholder="Type a relation and press Enter" />
                            <button type="submit" className="action-button secondary">Add</button>
                        </form>
                        <div className="relation-types-actions">
                            <button className="action-button secondary" onClick={handleSortRelationTypes}>Sort A-Z</button>
                        </div>
                        <div className="relation-types-list">
                            {relationTypes.length === 0 ? (
                                <div className="no-data">No relation types yet.</div>
                            ) : (
                                relationTypes.map((type, index) => (
                                    <div
                                        key={`${type}-${index}`}
                                        className="relation-type-tag"
                                        draggable
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={() => handleDrop(index)}
                                    >
                                        <span className="tag-handle">⋮⋮</span>
                                        <span className="tag-label">{type}</span>
                                        <button className="tag-remove" onClick={() => handleRemoveRelationType(type)} title="Remove">×</button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Assigned Users */}
            <div className="management-section">
                <div className="section-header">
                    <h2>Assigned Users ({assignedUsers.length})</h2>
                    <button onClick={() => setIsAssigning(!isAssigning)} className="action-button">
                        {isAssigning ? 'Cancel' : '＋ Assign User'}
                    </button>
                </div>
                {isAssigning && (
                    <form onSubmit={handleAssignUser} className="assign-user-form">
                        <select value={userToAssign} onChange={e => setUserToAssign(e.target.value)} required>
                            <option value="">-- Select a user to assign --</option>
                            {availableUsersToAssign.map(user => (
                                <option key={user.id} value={user.id}>{user.username} ({user.is_admin ? 'Admin' : 'User'})</option>
                            ))}
                        </select>
                        <button type="submit" className="action-button">Confirm Assignment</button>
                    </form>
                )}
                <div className="user-list">
                    <table>
                        <thead><tr><th>User ID</th><th>Username</th><th>Actions</th></tr></thead>
                        <tbody>
                            {assignedUsers.map(user => (
                                <tr key={user.id}>
                                    <td>{user.id}</td>
                                    <td>{user.username}</td>
                                    <td>
                                        <button onClick={() => handleRemoveUser(user.id, user.username)} className="action-button delete">Remove</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Chat Rooms */}
            <div className="management-section">
                <div className="section-header"><h2>Chat Rooms ({chatRooms.length})</h2></div>
                <div className="import-csv-section">
                    <h3>Import Chat Rooms</h3>
                    <p className="import-csv-hint">
                        Select one or more CSV files; each file becomes one chat room named after the file, and names must be unique in the project.
                        Up to {importLimits.max_file_mb} MB and {importLimits.max_rows.toLocaleString()} turns per file. Large selections are sent in several batches.
                    </p>
                    <div className="import-csv-row">
                        <input type="file" id="csv-file-input" accept=".csv,text/csv" multiple onChange={handleFileSelect} disabled={importBusy} />
                        <button onClick={handleValidateCsvs} disabled={importableCount === 0 || importBusy} className="action-button secondary">
                            {isPreviewing ? 'Validating...' : 'Validate'}
                        </button>
                        <button onClick={handleUploadCsvs} disabled={importableCount === 0 || importBusy} className="action-button">
                            {isUploading ? 'Importing...' : importableCount > 0 ? `Import ${importableCount} room${importableCount === 1 ? '' : 's'}` : 'Import'}
                        </button>
                        {importItems.length > 0 && (
                            <button onClick={handleClearImportItems} disabled={importBusy} className="action-button secondary">Clear list</button>
                        )}
                    </div>
                    {importProgress && (
                        <div className="import-progress" role="status">
                            <progress value={importProgress.done} max={importProgress.total} />
                            <span>{importProgress.label} {importProgress.done} / {importProgress.total} files</span>
                        </div>
                    )}
                    {importItems.length > 0 && (
                        <div className="import-file-list">
                            <div className="import-preview-header">
                                <strong>{importItems.length} file{importItems.length === 1 ? '' : 's'} selected</strong>
                                {importCounts.created ? ` · ${importCounts.created} imported` : ''}
                                {importCounts.invalid || importCounts.failed ? ` · ${(importCounts.invalid || 0) + (importCounts.failed || 0)} with problems` : ''}
                            </div>
                            <div className="import-preview-table">
                                <table>
                                    <thead><tr><th>File</th><th>Room name</th><th>Turns</th><th>Status</th><th>Actions</th></tr></thead>
                                    <tbody>
                                        {importItems.map((item) => {
                                            const itemStatus = importItemStatus(item);
                                            const label = importStatusLabel[itemStatus];
                                            const message = item.localProblem || item.serverMessage;
                                            return (
                                                <tr key={item.key}>
                                                    <td>{item.file.name}</td>
                                                    <td>{item.roomName || '-'}</td>
                                                    <td>{item.totalRows ?? '-'}</td>
                                                    <td>
                                                        <span className={`status-badge ${label.class}`}>{label.text}</span>
                                                        {message && <div className="preview-warning">{message}</div>}
                                                        {item.warnings.length > 0 && (
                                                            <div className="import-item-warnings" title={item.warnings.join('\n')}>
                                                                {item.warnings.length} warning{item.warnings.length === 1 ? '' : 's'}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="import-item-actions">
                                                        {itemStatus !== 'created' && (
                                                            <>
                                                                <button onClick={() => handlePreviewRows(item)} disabled={importBusy || !/\.csv$/i.test(item.file.name)} className="action-button secondary small">Rows</button>
                                                                <button onClick={() => handleRemoveImportItem(item.key)} disabled={importBusy} className="action-button secondary small">Remove</button>
                                                            </>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {previewError && <ErrorMessage type="warning" title="Preview Failed" message={previewError} />}
                    {importPreview && (
                        <div className="import-preview">
                            <div className="import-preview-header"><strong>{importPreview.filename}</strong> · <strong>Total rows:</strong> {importPreview.total_rows}</div>
                            {importPreview.warnings?.length > 0 && (
                                <div className="import-preview-warnings">
                                    {importPreview.warnings.map((w, i) => <div key={`warn-${i}`} className="preview-warning">{w}</div>)}
                                </div>
                            )}
                            <div className="import-preview-table">
                                <table>
                                    <thead><tr><th>turn_id</th><th>user_id</th><th>turn_text</th><th>reply_to_turn</th></tr></thead>
                                    <tbody>
                                        {importPreview.preview_rows.map((row, i) => (
                                            <tr key={`preview-${i}`}>
                                                <td>{row.turn_id}</td>
                                                <td>{row.user_id}</td>
                                                <td className="preview-text-cell">{row.turn_text}</td>
                                                <td>{row.reply_to_turn || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {importError && <ErrorMessage type="warning" title="Import Failed" message={importError} />}
                </div>

                {chatRooms.length === 0 ? (
                    <p className="no-data">No chat rooms in this project yet.</p>
                ) : (
                    <div className="chat-rooms-table">
                        <table>
                            <thead>
                                <tr><th>Chat Room</th><th>Status</th><th># Annotators</th><th>Avg. Agreement</th><th>Actions</th></tr>
                            </thead>
                            <tbody>
                                {chatRooms.map(room => {
                                    const analytics = chatRoomAnalytics[room.id] || {};
                                    return (
                                        <tr key={room.id}>
                                            <td>
                                                <strong>{room.name}</strong><br />
                                                <small>Created: {new Date(room.created_at).toLocaleDateString()}</small>
                                            </td>
                                            <td>{getStatusBadge(analytics.status)}</td>
                                            <td>{analytics.completedAnnotators || 0} / {analytics.totalAnnotators || 0}</td>
                                            <td>{analytics.averageAgreement
                                                ? (project.annotation_type === 'adjacency_pairs'
                                                    ? `${analytics.averageAgreement}`
                                                    : `${analytics.averageAgreement}%`)
                                                : 'N/A'}
                                            </td>
                                            <td className="actions-column">
                                                <div className="action-button-group">
                                                    <button onClick={() => handleViewChatRoom(room.id)} className="action-button view-button">View Chat</button>
                                                    <button onClick={() => handleOpenRenameChatRoom(room)} className="action-button">Rename</button>
                                                    <button
                                                        onClick={() => navigate(`/admin/projects/${project.id}/analysis/${room.id}`)}
                                                        className="action-button analyze-button"
                                                        disabled={!chatRoomAnalytics[room.id]?.canAnalyze}
                                                        title={!chatRoomAnalytics[room.id]?.canAnalyze ? 'No annotators assigned to this room' : 'Analyze annotations'}
                                                    >
                                                        Analyze
                                                    </button>
                                                    <button
                                                        onClick={() => handleExportChatRoom(room.id, room.name, chatRoomAnalytics[room.id])}
                                                        className="action-button export-button"
                                                        disabled={project.annotation_type !== 'adjacency_pairs' && !chatRoomAnalytics[room.id]?.canAnalyze}
                                                    >
                                                        {project.annotation_type === 'agreement_analysis' ? 'Export JSON' : 'Export'}
                                                    </button>
                                                    {project.annotation_type === 'agreement_analysis' && (
                                                        <button
                                                            onClick={() => handleExportAgreementCsv(room.id)}
                                                            className="action-button export-button"
                                                            disabled={!chatRoomAnalytics[room.id]?.canAnalyze}
                                                            title="Rubric record table (marked turns), one CSV per annotator"
                                                        >
                                                            Export CSV
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleDeleteChatRoom(room.id, room.name)} className="action-button delete">Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {chatRooms.length > 0 && ['disentanglement', 'question_analysis', 'agreement_analysis'].includes(project.annotation_type) && (
                    <div className="status-legend">
                        <h4>Status Legend:</h4>
                        <div className="legend-items">
                            <div className="legend-item"><span className="status-badge status-complete">Annotated</span><span className="legend-text">All annotators completed all messages</span></div>
                            <div className="legend-item"><span className="status-badge status-partial">In Progress</span><span className="legend-text">2+ annotators completed, but others still pending</span></div>
                            <div className="legend-item"><span className="status-badge status-insufficient">Insufficient Data</span><span className="legend-text">Less than 2 annotators completed all messages</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Export adjacency pairs modal */}
            <Modal isOpen={exportModal.visible} onClose={() => setExportModal({ visible: false, roomId: null, roomName: '' })} title="Export Adjacency Pairs" size="small">
                <div className="export-modal-content">
                    <label>Export scope</label>
                    <select value={exportAnnotatorId} onChange={e => setExportAnnotatorId(e.target.value)}>
                        <option value="all">All users</option>
                        {assignedUsers.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}
                    </select>
                    <button className="action-button export-button" onClick={handleExportAdjacencyPairs}>Export</button>
                </div>
            </Modal>

            {/* Rename chat room modal */}
            <Modal isOpen={editChatRoomModal.open} onClose={() => setEditChatRoomModal({ open: false, roomId: null, name: '' })} title="Rename chat room" size="small">
                <div className="rename-chat-room">
                    <label htmlFor="chat-room-name" className="form-label">Name</label>
                    <input
                        id="chat-room-name"
                        type="text"
                        value={editChatRoomModal.name}
                        onChange={e => setEditChatRoomModal(prev => ({ ...prev, name: e.target.value }))}
                        className="form-input"
                        placeholder="New chat room name"
                        disabled={isRenamingChatRoom}
                    />
                    <div className="modal-actions">
                        <button className="action-button secondary" onClick={() => setEditChatRoomModal({ open: false, roomId: null, name: '' })} disabled={isRenamingChatRoom}>Cancel</button>
                        <button className="action-button" onClick={handleRenameChatRoom} disabled={isRenamingChatRoom}>
                            {isRenamingChatRoom ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Danger zone */}
            <div className="management-section danger-zone">
                <h2>Danger Zone</h2>
                <div className="danger-zone-content">
                    <p>Deleting a project is a permanent action. It will remove the project, all its chat rooms, turns, and annotations.</p>
                    <div className="danger-zone-actions">
                        <button onClick={handleDeleteProject} className="action-button delete">Delete This Project</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminProjectPage;
