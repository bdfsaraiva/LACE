"""Add agreement_analysis_annotation table

Revision ID: 20261009_agreement_analysis
Revises: 20260611_is_question
Create Date: 2026-10-09
"""

from alembic import op
import sqlalchemy as sa


revision = "20261009_agreement_analysis"
down_revision = "20260611_is_question"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agreement_analysis_annotation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("annotator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("form", sa.String(), nullable=False),
        sa.Column("marker_check", sa.String(), nullable=True),
        sa.Column("marker_span", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("borderline", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("multiform", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("message_id", "annotator_id", name="uix_aa_message_annotator"),
    )
    op.create_index("ix_aa_annotation_message_annotator", "agreement_analysis_annotation", ["message_id", "annotator_id"])
    op.create_index("ix_aa_annotation_project", "agreement_analysis_annotation", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_aa_annotation_project", table_name="agreement_analysis_annotation")
    op.drop_index("ix_aa_annotation_message_annotator", table_name="agreement_analysis_annotation")
    op.drop_table("agreement_analysis_annotation")
