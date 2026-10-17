"""Policy engine (SPEC M6): AnalysisResult -> Actions via rules.yaml; plain code, no LLM."""
from pathlib import Path

import yaml

from cases import store
from cases.logutil import jlog
from contracts.models import Action, AnalysisResult
from policy_actions import claim, contacts_loader

RULES_PATH = Path(__file__).with_name("rules.yaml")


def load_rules() -> list[dict]:
    return yaml.safe_load(RULES_PATH.read_text())


def _matches(when: dict, result: AnalysisResult, claimed: dict | None) -> bool:
    labels = [s.label for s in result.segments]
    for key, want in when.items():
        if key == "any_segment":
            ok = want in labels
        elif key == "all_segments":
            ok = bool(labels) and all(lbl == want for lbl in labels)
        elif key == "claimed_contact":
            ok = (claimed is not None) if want == "known" else (claimed is None)
        elif key == "abstain":
            ok = bool(result.abstain) == bool(want)
        else:
            ok = False
        if not ok:
            return False
    return True


def decide(result: AnalysisResult, case_id: str, transcribe_fn=None) -> list[Action]:
    """Evaluate rules top to bottom, first match wins. Reads the member from the case."""
    member_id = store.get_case_row(case_id)["member_id"]
    claimed = claim.claimed_contact(result, member_id, transcribe_fn)
    trusted = contacts_loader.trusted(member_id)
    for rule in load_rules():
        if not _matches(rule["when"], result, claimed):
            continue
        actions: list[Action] = []
        for do in rule["do"]:
            if do == "verify_contact":
                if not claimed:
                    continue
                c = contacts_loader.contact(member_id, claimed["contact_id"]) or {}
                reason = (f"Synthetic turn {claimed['start']:.1f}-{claimed['end']:.1f}s claims to be "
                          f"{c.get('name', claimed['contact_id'])} (matched by {claimed['method']}; "
                          f"quoted transcript: \"{claimed['text']}\")")
                actions.append(Action(type="verify_contact", case_id=case_id,
                                      target=claimed["contact_id"], reason=reason))
            elif do == "hold_new_payee":
                actions.append(Action(type="hold_new_payee", case_id=case_id, target=None,
                                      reason=f"rule {rule['id']}: new-payee transfers held until verified"))
            elif do == "notify_trusted_contact":
                actions.append(Action(type="notify_trusted_contact", case_id=case_id,
                                      target=(trusted or {}).get("id"),
                                      reason=f"rule {rule['id']}: alert trusted contact"))
        jlog("policy_decided", case_id=case_id, rule=rule["id"], actions=[a.type for a in actions])
        return actions
    jlog("policy_decided", case_id=case_id, rule=None, actions=[])
    return []


def execute(actions: list[Action]) -> list[dict]:
    """Carry out actions: record each as an `action` case event, then run its side effect."""
    from policy_actions import verifier

    done: list[dict] = []
    for a in actions:
        store.append(a.case_id, "action", a.model_dump())
        if a.type == "verify_contact" and a.target:
            verifier.send_verification(a.case_id, a.target)
        elif a.type == "notify_trusted_contact":
            verifier.notify_trusted(a.case_id, a.reason)
        done.append(a.model_dump())
    return done
