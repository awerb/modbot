import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Date, ForeignKey, Text, Enum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
import enum

from .db import Base


def _uuid():
    return str(uuid.uuid4())


class MessageSource(str, enum.Enum):
    seeded = "seeded"
    simulated = "simulated"
    whatsapp = "whatsapp"


class Group(Base):
    __tablename__ = "groups"
    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    whatsapp_jid = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship("Member", back_populates="group", cascade="all, delete-orphan")


class Member(Base):
    __tablename__ = "members"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    display_name = Column(String, nullable=False)
    archetype = Column(String, nullable=False)
    avatar_color = Column(String, nullable=False)
    avatar_initial = Column(String, nullable=False, default="?")
    whatsapp_jid = Column(String, nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="members")


class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    member_id = Column(String, ForeignKey("members.id"), nullable=False)
    text = Column(Text, nullable=False)
    word_count = Column(Integer, default=0)
    is_forwarded = Column(Boolean, default=False)
    # held | released | discarded | n/a
    forward_friction_status = Column(String, default="n/a")
    has_media = Column(Boolean, default=False)
    raw_payload = Column(JSONB, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow)
    source = Column(String, default="seeded")


class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(String, primary_key=True, default=_uuid)
    message_id = Column(String, ForeignKey("messages.id"), nullable=False, index=True)
    factuality_score = Column(Float, nullable=True)
    factuality_notes = Column(Text, nullable=True)
    has_unsourced_claim = Column(Boolean, default=False)
    target_flag = Column(Boolean, default=False)
    target_category = Column(String, nullable=True)
    target_notes = Column(Text, nullable=True)
    topic_tags = Column(ARRAY(String), default=list)
    model = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Phase 2 additions
    heat_score = Column(Float, nullable=True)            # 0..1
    is_disagreement = Column(Boolean, default=False)
    steelman_present = Column(Boolean, default=False)
    is_question = Column(Boolean, default=False)
    is_assertion = Column(Boolean, default=False)
    is_repair = Column(Boolean, default=False)
    repair_notes = Column(Text, nullable=True)
    references_member_id = Column(String, nullable=True)


class GroupState(Base):
    __tablename__ = "group_state"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False, unique=True)
    rolling_heat = Column(Float, default=0.0)
    last_pause_prompt_at = Column(DateTime, nullable=True)
    question_assertion_ratio_7d = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class MemberState(Base):
    __tablename__ = "member_state"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    member_id = Column(String, ForeignKey("members.id"), nullable=False, unique=True)
    last_substantive_post_at = Column(DateTime, nullable=True)
    last_contested_exchange_at = Column(DateTime, nullable=True)
    silent_since = Column(DateTime, nullable=True)
    repair_count = Column(Integer, default=0)
    steelman_count = Column(Integer, default=0)


class ModeratorAlert(Base):
    __tablename__ = "moderator_alerts"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    # kinds: pause_suggested | steelman_missing | repair_detected | exit_velocity | quiet_member_substantive
    kind = Column(String, nullable=False)
    payload = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at = Column(DateTime, nullable=True)


class DailyArtifact(Base):
    __tablename__ = "daily_artifacts"
    id = Column(String, primary_key=True, default=_uuid)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    date = Column(Date, nullable=False)
    summary = Column(Text, nullable=True)
    suggested_question = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
