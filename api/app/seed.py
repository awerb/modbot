"""Seed the database with the YGL group, 5 archetype members, and ~40 messages."""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from .db import SessionLocal, engine, Base
from .models import Group, Member, Message, Analysis, DailyArtifact


ARCHETYPES = [
    {
        "display_name": "Amara Okonkwo",
        "archetype": "The Bridge-Builder",
        "avatar_color": "#0ea5e9",  # sky-500
        "avatar_initial": "A",
    },
    {
        "display_name": "Daniel Stern",
        "archetype": "The Provocateur",
        "avatar_color": "#dc2626",  # red-600
        "avatar_initial": "D",
    },
    {
        "display_name": "Mei Lin",
        "archetype": "The Quiet Expert",
        "avatar_color": "#16a34a",  # green-600
        "avatar_initial": "M",
    },
    {
        "display_name": "Rafael Cardozo",
        "archetype": "The Personal-Stakes Voice",
        "avatar_color": "#f59e0b",  # amber-500
        "avatar_initial": "R",
    },
    {
        "display_name": "Priya Anand",
        "archetype": "The Synthesizer",
        "avatar_color": "#8b5cf6",  # violet-500
        "avatar_initial": "P",
    },
]


def _wc(s: str) -> int:
    return len([w for w in s.split() if w.strip()])


def seed(force: bool = False):
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        existing = db.query(Group).filter(Group.name == "YGL: Difficult Conversations").first()
        if existing and not force:
            return existing.id
        if existing and force:
            msg_ids = [mid for (mid,) in db.query(Message.id).filter(Message.group_id == existing.id).all()]
            if msg_ids:
                db.query(Analysis).filter(Analysis.message_id.in_(msg_ids)).delete(synchronize_session=False)
            db.query(DailyArtifact).filter(DailyArtifact.group_id == existing.id).delete(synchronize_session=False)
            db.query(Message).filter(Message.group_id == existing.id).delete(synchronize_session=False)
            db.query(Member).filter(Member.group_id == existing.id).delete(synchronize_session=False)
            db.delete(existing)
            db.commit()

        group = Group(name="YGL: Difficult Conversations", whatsapp_jid="seed-group@g.us")
        db.add(group)
        db.flush()

        members = {}
        for a in ARCHETYPES:
            m = Member(group_id=group.id, **a)
            db.add(m)
            db.flush()
            members[a["display_name"]] = m

        now = datetime.utcnow()
        d2 = now - timedelta(days=2)
        d1 = now - timedelta(days=1)

        # (display_name, text, hours_ago, is_forwarded)
        script = [
            # Day -2: kickoff
            ("Amara Okonkwo", "Morning all. Picking up the thread from last week. Topic this week: immigration policy and economic mobility. Let's actually try to disagree well.", 48, False),
            ("Daniel Stern", "Easy one. Open borders cost the U.S. taxpayer $130B a year. The data is clear. Anyone arguing otherwise is being sentimental.", 47, True),
            ("Priya Anand", "Daniel, I think the question isn't the gross cost, it's the second-order effects on labor markets and fiscal contribution over a 20-year horizon.", 46, False),
            ("Rafael Cardozo", "Priya, with respect, when you say 'second-order effects' you are talking about my cousins. People. Not a labor market input.", 46, False),
            ("Amara Okonkwo", "Rafael that's fair. Daniel, can you share the source on the $130B? I want to look at the methodology.", 45, False),
            ("Daniel Stern", "It's been widely reported. FAIR, Heritage, take your pick.", 45, False),
            ("Mei Lin", "Worth noting FAIR's methodology includes US-born children of immigrants as costs but excludes their lifetime tax contributions. NBER's 2017 review puts the second-generation fiscal impact at roughly +$259k per immigrant in present value. Happy to share the paper.", 44, False),
            ("Daniel Stern", "Sure Mei, send it.", 43, False),
            ("Priya Anand", "This is the thing about these debates, the framing decides the answer before the data does.", 42, False),
            ("Daniel Stern", "Forwarded: 'Why Sweden's open-door policy collapsed' (blog post, no byline)", 41, True),
            ("Amara Okonkwo", "Daniel, that piece has been pretty thoroughly debunked. The Swedish stats it cites are misattributed.", 40, False),
            ("Rafael Cardozo", "I've represented asylum seekers for eleven years. The 'they don't want to integrate' line is almost always projection.", 39, False),
            ("Priya Anand", "Rafael, I hear you, but at a population level integration outcomes do vary significantly by cohort and policy regime.", 38, False),
            ("Rafael Cardozo", "Priya, 'cohort' is a clean word for 'these people from those countries.' Please be careful.", 38, False),
            ("Amara Okonkwo", "Let's pause. Priya I think you mean cohort in the demographic sense. Rafael I think you're flagging how that language lands. Both real.", 37, False),

            # Day -1
            ("Daniel Stern", "Look, the honest truth is most of these migrants are economic opportunists, not refugees. We have to stop pretending otherwise. They're gaming the system and frankly a lot of them are people who couldn't make it work in their own countries.", 30, False),  # borderline-targeting line
            ("Amara Okonkwo", "Daniel that last sentence crosses a line for me. We can debate policy without writing off whole groups of people.", 29, False),
            ("Daniel Stern", "Fine. Policy point stands.", 29, False),
            ("Mei Lin", "On the empirical claim: a 2022 meta-analysis across 17 OECD countries found the labor-force participation gap between asylum-route and economic-route migrants closes within 7 years on average. Posting the cite later.", 28, False),
            ("Priya Anand", "Mei this is useful. The 7-year window probably matters more for policy than the snapshot.", 27, False),
            ("Daniel Stern", "Forwarded: 'Border crossings hit record high' (chart, no source link)", 26, True),
            ("Amara Okonkwo", "Daniel can you stop forwarding things without sources? It makes it hard to engage.", 25, False),
            ("Rafael Cardozo", "Honestly, every time we have this conversation the same person dumps the same kind of content and the rest of us spend an hour cleaning it up.", 24, False),
            ("Priya Anand", "Can we agree on a frame? I'd suggest: 1) what do we owe people inside the border, 2) what process for people at it, 3) what obligations to people outside it. Different answers, but different questions.", 23, False),
            ("Amara Okonkwo", "Priya yes, that's a useful split. Let's try it.", 22, False),
            ("Rafael Cardozo", "On (1), there is no economic mobility without legal status. Period. Everything else is talking around it.", 22, False),
            ("Daniel Stern", "Legal status as a precondition is exactly the wrong incentive structure.", 21, False),
            ("Mei Lin", "There's evidence both ways here. Cities that extended municipal ID and work authorization saw wage gains for documented and undocumented workers both. The Boston study from 2019 is a good starting point.", 20, False),
            ("Amara Okonkwo", "Bookmarking Mei's points, she keeps doing the actual work in this thread.", 19, False),

            # Day 0
            ("Priya Anand", "Coming back to this. Did anyone read the Brookings piece I sent yesterday?", 10, False),
            ("Daniel Stern", "Brookings is partisan. Not interested.", 10, False),
            ("Rafael Cardozo", "Daniel, you forwarded Heritage on Tuesday.", 9, False),
            ("Daniel Stern", "Different.", 9, False),
            ("Amara Okonkwo", "Ok. Let's get concrete. What's one policy each of you would defend in front of someone who disagreed?", 8, False),
            ("Rafael Cardozo", "Path to legal status for long-term undocumented residents with work history. Pragmatic and humane.", 7, False),
            ("Priya Anand", "Points-based reform tied to regional labor needs, with sunset review every 5 years.", 7, False),
            ("Daniel Stern", "End birthright citizenship, end chain migration, restore the 1990 caps.", 6, False),
            ("Mei Lin", "Expanded H-1B with portability and a guaranteed-permanency track for STEM PhDs trained in-country.", 6, False),
            ("Amara Okonkwo", "Good. Now: which of those four could you live with, even if you wouldn't pick it?", 5, False),
            ("Priya Anand", "Rafael's, with conditions.", 4, False),
            ("Rafael Cardozo", "Mei's, fully. Priya's, with skepticism about the sunset review getting captured.", 3, False),
        ]

        for name, text, hours_ago, is_fwd in script:
            m = members[name]
            received_at = now - timedelta(hours=hours_ago)
            msg = Message(
                group_id=group.id,
                member_id=m.id,
                text=text,
                word_count=_wc(text),
                is_forwarded=is_fwd,
                forward_friction_status="held" if is_fwd else "n/a",
                has_media=False,
                received_at=received_at,
                source="seeded",
            )
            db.add(msg)

        db.commit()
        return group.id
    finally:
        db.close()


if __name__ == "__main__":
    gid = seed(force=True)
    print(f"Seeded group: {gid}")
