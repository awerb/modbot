"""Seed the database with the YGL group, 5 archetype members, and ~40 messages."""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from .db import SessionLocal, engine, Base
from .models import Group, Member, Message, Analysis, DailyArtifact, GroupState, MemberState, ModeratorAlert


ARCHETYPES = [
    {
        "display_name": "Amara Okonkwo",
        "archetype": "The Bridge-Builder",
        "avatar_color": "#0ea5e9",  # sky-500
        "avatar_initial": "A",
    },
    {
        "display_name": "Michael Standup",
        "archetype": "The Provocateur",
        "avatar_color": "#dc2626",  # red-600
        "avatar_initial": "M",
    },
    {
        "display_name": "Mei Lin",
        "archetype": "The Quiet Expert",
        "avatar_color": "#16a34a",  # green-600
        "avatar_initial": "L",
    },
    {
        "display_name": "Rafael Cardozo",
        "archetype": "The Personal-Stakes Voice",
        "avatar_color": "#f59e0b",  # amber-500
        "avatar_initial": "R",
    },
    {
        "display_name": "Priya Anand",
        "archetype": "The Strident Voice",
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
            db.query(ModeratorAlert).filter(ModeratorAlert.group_id == existing.id).delete(synchronize_session=False)
            db.query(MemberState).filter(MemberState.group_id == existing.id).delete(synchronize_session=False)
            db.query(GroupState).filter(GroupState.group_id == existing.id).delete(synchronize_session=False)
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

        # (display_name, text, hours_ago, is_forwarded)
        script = [
            # ===== Day -2: kickoff =====
            ("Amara Okonkwo", "Morning all. New week, hardest topic yet. Gaza, the Iran strikes, and the question of whether the US is an imperial power. Let's actually try to disagree well.", 48, False),
            ("Michael Standup", "America isn't an empire. We are the stabilizer. Pull US presence out of the Gulf and you'd have a regional war by sundown. The data is clear.", 47, False),
            ("Priya Anand", "Michael, please. We bombed seven countries last year. We're arming a campaign in Gaza that the ICJ found plausibly genocidal. You can call that stabilization if you want. The bodies don't care what you call it.", 46, False),
            ("Rafael Cardozo", "I represent asylum seekers from Yemen, Sudan, and now Gaza. Two of my clients lost their entire families in Rafah to US-supplied munitions. This isn't a frame debate. It's a moral emergency.", 46, False),
            ("Amara Okonkwo", "Mei, you've worked on the dual-use export data. Anything to ground us?", 45, False),
            ("Mei Lin", "Yes. As of February the State Department had approved over $17.9B in arms transfers to Israel since October 7. CSIS estimates roughly 70 percent of munitions used in Gaza are US-origin. Posting the sourced summary later today.", 44, False),
            ("Michael Standup", "Mei that's tonnage not policy. Israel has a right to defend itself after the worst antisemitic massacre since 1945. You can't moralize that away with a procurement table.", 43, False),
            ("Priya Anand", "Nobody is moralizing anything away. Forty thousand dead. Whole bloodlines gone. Hospitals, journalists, aid workers. If your framework can't say that's wrong without a five-step justification then your framework is the problem.", 42, False),
            ("Michael Standup", "Forwarded: 'Why the Houthi threat justified the strikes' (Substack, no byline)", 41, True),
            ("Amara Okonkwo", "Michael, that piece has been pretty thoroughly debunked. The casualty numbers in it are off by an order of magnitude.", 40, False),
            ("Rafael Cardozo", "We keep doing this. Michael forwards a piece, we spend an hour cleaning it up, and the actual question, are we complicit, never gets asked.", 39, False),
            ("Priya Anand", "Of course we're complicit. We pay for it. We veto every ceasefire. We protect the people pulling the trigger from accountability at The Hague. Saying anything else is a lie we tell ourselves so we can keep sleeping.", 38, False),
            ("Michael Standup", "Priya you sound like a freshman seminar. The world is more complicated than a slogan. Iran funds Hezbollah, Hamas, the Houthis. We do not exist in a vacuum.", 37, False),
            ("Amara Okonkwo", "Hold on. Michael, 'you sound like a freshman seminar' is a swipe, not an argument. Priya is naming things that are documented. Can we keep this on the substance.", 37, False),
            ("Mei Lin", "On Iran specifically: the IAEA's most recent quarterly report shows enrichment at the Fordow facility at 84 percent purity, not weapons grade but close. The strikes hit centrifuge halls but the program isn't ended. It's accelerated.", 36, False),

            # ===== Day -1 =====
            ("Michael Standup", "The strikes worked. Iran's leadership is humiliated, the program is set back years, and the entire Middle East is safer because of it. People who can't see that are blinded by their politics.", 30, False),
            ("Priya Anand", "Michael that is not an argument it is propaganda. Mei just told you the program is accelerated. You're literally responding to data with vibes.", 29, False),
            ("Michael Standup", "Look, the honest truth is most of the people screaming 'imperialism' have never run a country, never made a hard call, and frankly couldn't tell you where Iran is on a map. They're useful idiots for Tehran whether they know it or not.", 28, False),  # borderline targeting
            ("Amara Okonkwo", "Michael. That last sentence crosses a line for me. You can argue the policy without writing off everyone who disagrees as a useful idiot. That's the kind of thing that ends conversations.", 28, False),
            ("Michael Standup", "Fair. I'll pull that back. The strategic point stands.", 27, False),
            ("Rafael Cardozo", "Thank you Amara.", 27, False),
            ("Priya Anand", "I appreciate the walk-back Michael. Genuinely. I get heated because this isn't abstract for me. My cousin works for an aid org in Khan Younis. He hasn't been heard from in eleven days.", 26, False),
            ("Michael Standup", "Priya, I'm sorry. I didn't know.", 26, False),
            ("Mei Lin", "There is a serious empirical literature on whether US foreign deployments reduce or produce regional conflict. The Posen / Brooks debate is the cleanest framing I've found. Neither side gets to skip it. I'll link tomorrow.", 25, False),
            ("Michael Standup", "Forwarded: 'Gaza death toll inflated by Hamas Ministry' (blog post, screenshots, no source link)", 24, True),
            ("Amara Okonkwo", "Michael, can you stop forwarding things without sources? Especially on death tolls. It's beneath us.", 24, False),
            ("Priya Anand", "Forty thousand. UN, WHO, ICRC, Lancet. Every serious institution confirms it. Stop laundering denial through your group chat.", 23, False),
            ("Rafael Cardozo", "On the imperialism question. I think the word does work. We have 750 military bases in 80 countries. We dictate which currencies clear which trades. We decide who gets sanctioned and who doesn't. If that's not empire then the word means nothing.", 22, False),
            ("Priya Anand", "Yes. Exactly. The reason we're squeamish about the word is because we like the benefits. Cheap gas, cheap clothes, dominant currency. Empire pays well at home as long as the violence happens elsewhere.", 21, False),
            ("Michael Standup", "And the alternative is what, Priya. China runs the Pacific. Russia runs Eastern Europe. Iran runs the Gulf. Tell me which of those worlds is more humane than the one you're describing.", 20, False),
            ("Mei Lin", "That's a false trilemma but it's the right disagreement to have. The actual empirical question is whether US primacy is necessary for global stability or whether it produces the instability it claims to prevent. Both have evidence. The honest answer is contested.", 19, False),
            ("Amara Okonkwo", "Mei, thank you. That's the conversation I want us in.", 18, False),

            # ===== Day 0 =====
            ("Priya Anand", "I want to come back to Gaza. We keep drifting to strategy because it's easier. A ten-year-old in Deir al-Balah was killed yesterday by a US-made bomb. That happened. Whatever frame you use, that happened.", 10, False),
            ("Michael Standup", "Priya, you can't run a foreign policy on individual tragedies. Every war has them. The question is what produces fewer of them over a decade, not what feels most acute today.", 9, False),
            ("Rafael Cardozo", "Michael that sentence is exactly why people get angry. You said 'individual tragedies.' Forty thousand is not individual. And the framework you're defending is the one that produced them. You don't get to use the math both ways.", 9, False),
            ("Amara Okonkwo", "Pause. Let's get concrete. Each of you, one policy you would defend in front of someone who lost a family member.", 8, False),
            ("Rafael Cardozo", "Immediate unconditional ceasefire, conditional arms transfers, ICC jurisdiction accepted by the US.", 7, False),
            ("Priya Anand", "Same plus reparations, war crimes prosecutions for everyone in the chain of command, and recognition of Palestine. We can do this. We choose not to.", 7, False),
            ("Mei Lin", "Conditional arms transfers tied to compliance benchmarks, accelerated ICJ proceedings, regional security architecture that includes Iran. Hardest of these is the third.", 6, False),
            ("Michael Standup", "Sustained credible deterrence, full backing of Israeli self-defense, full sanctions on Iran, and a clear off-ramp once Hamas releases hostages and disarms.", 6, False),
            ("Amara Okonkwo", "Good. Now whose position can you live with even if you wouldn't pick it?", 5, False),
            ("Priya Anand", "Mei's. I would fight for more but I could vote for it.", 4, False),
            ("Rafael Cardozo", "Mei's, fully. Michael's, no, because it doesn't pass the test of looking my client in the eye.", 3, False),
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
