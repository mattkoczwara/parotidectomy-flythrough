# Opening hero portrait: likeness gate (Gate 0)

**Contents:** Status · What the published terms say · Draft permission request · If permission is not obtained

## Status

**Resolved (2026-10-06) by abandoning the real-person scan.** The owner chose Blender Studio's Human Base Meshes (CC0, a synthetic sculpt, no person depicted) as the hero's foundation (ADR-0005, opening hero asset). The scan was never downloaded. The record below is kept for the reasoning.

## What the published terms say

Checked 2026-10-06.
- **Candidate:** "Infinite, 3D Head Scan by Lee Perry-Smith" (Infinite-Realities, 2010). Mirror: three.js `examples/models/gltf/LeePerrySmith/`.
- **`LeePerrySmith_License.txt`:**
  - Creative Commons Attribution 3.0 Unported.
  - "Based on a work at www.triplegangers.com".
  - Permissions beyond the licence are referred to ir-ltd.net.
- **Who was scanned:** neither the licence file nor the 2010 announcements (CG Channel, CGPress) name the person scanned. Nor do they mention a model release, the subject's consent, or any restriction on use. The original ir-ltd.net release page no longer resolves.
- **Triplegangers:** its scan library is described as being for "artistic and research purposes". No release terms covering sensitive uses could be found.
- **What CC BY covers:** it licenses copyright only. The CC 3.0 licence says publicity, privacy and moral rights are not licensed. Showing an identifiable person as the patient surrogate in an atlas about a parotid tumour and its surgery is the kind of sensitive use that stock model releases often exclude.

Conclusion: copyright allows redistribution with attribution. Likeness permission for this use cannot be established from public sources.

## Draft permission request (for the owner to send to Infinite-Realities, ir-ltd.net, and Triplegangers)

> Subject: Permission request: "Infinite" head scan (CC BY 3.0) in a medical-education atlas
>
> Hello,
>
> I'm building a free, non-commercial educational atlas of parotid gland tumours and parotidectomy (salivary gland surgery). It is published as open source at github.com/mattkoczwara/parotidectomy-flythrough.
>
> I'd like to use the "Infinite, 3D Head Scan by Lee Perry-Smith" (CC BY 3.0, based on a work at triplegangers.com) as the face shown on the atlas's opening page. The figure would carry no depiction of disease; the anatomy and the tumour shown later come from a separate, donated anatomical dataset. The opening text, however, explains that the atlas follows a parotid tumour and its operation, so the figure stands in for a patient.
>
> We would modify the scan by adding hair, shoulders and new skin maps, attribute it as the licence requires, and redistribute the adapted model publicly under CC BY 3.0.
>
> Could you confirm that the person scanned consented to a release that covers this use? If so, would you give written permission for it? If that isn't possible, we'll use a different source.
>
> Thank you,
> Matt Koczwara

## If permission is not obtained

The plan's option (b) applies: use a synthetic human, or a commercially licensed one with explicit redistribution and likeness rights. If its licence forbids redistribution in a public repository, the asset stays out of git (as `docs/references/` does), and the public build keeps the morph portrait. The work plan does not depend on the source: only the head import and registration change.
