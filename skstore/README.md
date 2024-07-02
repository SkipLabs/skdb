# SKStore

## Examples

### SpreadSheet

The SpreadSheet example is in ts/examples/sheet.ts
This allows to use the main features of SKStore (ie eager map, lazy compute)

To run it run:

```
cd .. && make launch-sheet
```

A promp appears:
It accept following command:

- `input <table-name> [[<c1v1>, <c2v1>],[<c1v2>, <c2v2>]]`
- `delete <table-name> {"<c1>":<c1v>, ...}`
- `update <table-name> {"where":{"<c1>":<c1v>, ...}, "update":{"<cn>":<cnv>}}`
- `watch <table-name>`
- `watch-changes <table-name>`
- `close <table-name>`
- `exit`

It's possible to play a predefine scenario running `play 1`

Or step by step running `start 1` then enter for each step