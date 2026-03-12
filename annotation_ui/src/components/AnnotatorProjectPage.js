import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { projects } from '../utils/api';
import './AnnotatorProjectPage.css';

const AnnotatorProjectPage = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const [project, setProject] = useState(null);
    const [chatRooms, setChatRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch project details and chat rooms in parallel
                const [projectData, chatRoomsData] = await Promise.all([
                    projects.getProject(projectId),
                    projects.getChatRooms(projectId)
                ]);
                setProject(projectData);
                setChatRooms(chatRoomsData);
            } catch (err) {
                setError(err.response?.data?.detail || err.message || 'Failed to fetch project data');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [projectId]);

    if (loading) return <div className="loading">Loading project...</div>;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <div className="annotator-project-page">
            <header className="project-page-header">
                <div className="header-top">
                    <button onClick={() => navigate('/dashboard')} className="back-button">
                        ← Back to Dashboard
                    </button>
                    <h2>{project.name}</h2>
                </div>
                <p>{project.description}</p>
                <p className="project-meta">
                    Annotation Type: {project.annotation_type === 'adjacency_pairs' ? 'Adjacency Pairs' : 'Chat Disentanglement'}
                </p>
                {project.annotation_type !== 'adjacency_pairs' && (
                    <div className="project-actions">
                        <Link 
                            to={`/projects/${projectId}/my-annotations`}
                            className="my-annotations-button"
                        >
                            📊 View My Annotations
                        </Link>
                    </div>
                )}
            </header>
            
            <h3>Available Chat Rooms for Annotation</h3>
            <div className="chat-room-table-container">
                {chatRooms.length === 0 ? (
                    <div className="empty-state">
                        <p>No chat rooms available in this project.</p>
                    </div>
                ) : (
                    <table className="chat-room-table">
                        <thead>
                            <tr>
                                <th>Chat Room Name</th>
                                <th>Description</th>
                                <th>Created</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {chatRooms.map(room => (
                                <tr key={room.id} className="chat-room-row">
                                    <td className="room-name">
                                        <strong>{room.name}</strong>
                                    </td>
                                    <td className="room-description">
                                        {room.description || 'No description'}
                                    </td>
                                    <td className="room-created">
                                        {new Date(room.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="room-action">
                                        <Link 
                                            to={`/projects/${projectId}/chat-rooms/${room.id}`}
                                            className="annotate-button"
                                        >
                                            🎯 Start Annotating
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default AnnotatorProjectPage; 
