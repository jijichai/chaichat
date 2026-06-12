-- Membership-gated groupchats: a chat that only members of an EXTERNAL Circles
-- group (one we don't own) may join. gate_group_address is the group avatar
-- whose trust list defines membership (group → member trust edge). Distinct from
-- group_address, which is an on-chain Base Group WE deployed for this circle.
ALTER TABLE circles ADD COLUMN gate_group_address TEXT;
