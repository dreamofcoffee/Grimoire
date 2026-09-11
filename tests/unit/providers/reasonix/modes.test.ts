import {
  mapGrimoireModeToReasonix,
  mapGrimoireModeToReasonixApproval,
  mapReasonixModeToGrimoire,
} from '@/providers/reasonix/modes';

describe('Reasonix ACP mode mapping', () => {
  it('maps Grimoire modes to the session modes the recording offers', () => {
    // `normal`, `plan` and `goal` are what `session/new` lists. Auto-approve is
    // not among them, because it is not a mode.
    expect(mapGrimoireModeToReasonix('normal')).toBe('normal');
    expect(mapGrimoireModeToReasonix('full_access')).toBe('normal');
    expect(mapGrimoireModeToReasonix('plan')).toBe('plan');
    expect(mapGrimoireModeToReasonix(undefined)).toBe('normal');
  });

  it('spends Auto-approve on the approval posture, not on the mode', () => {
    expect(mapGrimoireModeToReasonixApproval('full_access')).toBe('yolo');
    expect(mapGrimoireModeToReasonixApproval('yolo')).toBe('yolo');
    expect(mapGrimoireModeToReasonixApproval('normal')).toBe('ask');
    expect(mapGrimoireModeToReasonixApproval('plan')).toBe('ask');
    expect(mapGrimoireModeToReasonixApproval(undefined)).toBe('ask');
  });

  it('reads every mode that is not plan as Safe, and never as Auto-approve', () => {
    // `goal` is Reasonix's own third mode and Grimoire has no position for it.
    // Answering Auto-approve for any reported mode would let a
    // `current_mode_update` grant permissions the user did not pick.
    expect(mapReasonixModeToGrimoire('normal')).toBe('normal');
    expect(mapReasonixModeToGrimoire('goal')).toBe('normal');
    expect(mapReasonixModeToGrimoire(undefined)).toBe('normal');
    expect(mapReasonixModeToGrimoire('plan')).toBe('plan');
  });
});
