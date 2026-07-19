CREATE INDEX "Note_content_search_idx"
  ON "Note"
  USING GIN ((
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("contentText", '')), 'B')
  ));

CREATE INDEX "Note_title_lower_idx" ON "Note" (lower("title"));
