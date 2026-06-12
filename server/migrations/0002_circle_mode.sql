-- Access-control mode for circles/groupchats.
-- 'open'         — anyone can join
-- 'mutual-trust' — joiner and creator must mutually trust on the Circles graph
ALTER TABLE circles ADD COLUMN mode TEXT NOT NULL DEFAULT 'open';
