# Fixtures

Upstream API.NSW responses used by the tests. No test calls the live API.

Every shape here is taken from the examples and schemas in the v2 Swagger spec
(https://apinsw.onegov.nsw.gov.au/api/swagger/spec/22). The token response is
the shape of a real response posted publicly, with every value replaced. Rows
have been added beyond the spec's single examples so the tests can cover what
the spec documents but its examples do not show together: a Tasmanian row in
v2 data, integer station codes (nearby) next to string codes (location), both
`lastupdated` formats, a station with no price for the requested fuel, and a
tie on price.

Replace these with recorded real responses once credentials exist. See
docs/api-notes.md.
