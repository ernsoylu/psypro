/**
 * The active industry profile, and which envelopes are drawn.
 *
 * A profile is **presentation and defaults only**. `REQUIREMENTS.md` §10 is
 * explicit that it never changes the thermodynamics, and
 * `src/data/profiles.test.ts` asserts it: the same state point resolves to
 * byte-identical properties under all three.
 *
 * That guarantee is what makes profiles safe to offer at all. A "data centre
 * mode" that quietly changed a correlation would be a different tool wearing the
 * same name, and a reader comparing two designs across profiles would be
 * comparing nothing.
 */

import { create } from 'zustand';

import { PROFILES, profileById } from '../data';

/** What the profile store holds. */
export interface ProfileState {
  /** The active profile's id. */
  profileId: string;
  /** Envelope ids currently drawn, which the profile seeds but does not own. */
  visibleEnvelopes: string[];

  setProfile: (id: string) => void;
  toggleEnvelope: (id: string) => void;
}

const DEFAULT = PROFILES[0]?.id ?? 'hvac';

export const useProfileStore = create<ProfileState>((set) => ({
  profileId: DEFAULT,
  visibleEnvelopes: profileById(DEFAULT)?.envelopes ?? [],

  setProfile: (profileId) =>
    set({
      profileId,
      // Switching profile reseeds the overlays rather than merging them: the
      // point of a profile is to arrive at a sensible starting view, and
      // carrying a data-centre envelope into a comfort design is noise.
      visibleEnvelopes: profileById(profileId)?.envelopes ?? [],
    }),

  toggleEnvelope: (id) =>
    set((s) => ({
      visibleEnvelopes: s.visibleEnvelopes.includes(id)
        ? s.visibleEnvelopes.filter((e) => e !== id)
        : [...s.visibleEnvelopes, id],
    })),
}));
