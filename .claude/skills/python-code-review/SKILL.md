---
description: Reviews Python code for idiomatic style, error handling, typing and common runtime pitfalls
---

# Python Code Review

Use this skill when a changed file has a `.py` extension.

## Idioms
- Comprehensions and generators instead of manual accumulator loops
- `with` statements for files, locks and connections
- `pathlib` instead of string path concatenation
- f-strings instead of `%` formatting or `+` concatenation
- `dataclasses` (or `pydantic`) instead of loose dictionaries

## Pitfalls
- Mutable default arguments (`def f(x=[])`)
- Bare `except:` and swallowed exceptions
- Late-binding closures in loops
- Comparing to `None` with `==`
- `is` used for value comparison
- Modifying a list while iterating over it

## Typing and Structure
- Missing type hints on public functions
- `Any` where a `Protocol` or `TypedDict` would be clearer
- Functions longer than a screen, or with many boolean flags

## Security
- `pickle.loads`, `yaml.load` without `SafeLoader`, `eval`/`exec`
- `subprocess` with `shell=True` and interpolated input
- SQL built with f-strings

## Output
Line number, severity, explanation, and a corrected snippet for each finding.
