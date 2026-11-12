# 🔍 Code Review Report

**Pull request:** udacity/cd14715-simple-todo-app#2

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 22/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 9 |
| **Refactoring Opportunities** | 6 |

## 🎯 Top Recommendations

1. 🚨 **Security**: Fix three SQL injection vulnerabilities in searchTodos, searchTodosByStatus, and getTodosByUser functions. These allow arbitrary SQL execution and must be remediated immediately by replacing string concatenation/interpolation with parameterized queries.
   - Files: src/todo.ts

2. 🚨 **Testing**: Add security tests to verify SQL injection vulnerabilities are fixed. Test the three vulnerable search functions with malicious payloads to ensure parameterized queries prevent exploitation.
   - Files: src/todo.ts

3. 🚨 **Testing**: Add comprehensive tests for database operations. Critical gaps include createTodo, getAllTodos, getTodoById, updateTodoStatus, and deleteTodo with no test coverage for database interactions or error handling.
   - Files: src/todo.ts

4. ⚠️ **Security**: Replace weak ID generation (Math.random + timestamp) with cryptographically secure randomUUID from crypto module to prevent IDOR attacks through ID enumeration.
   - Files: src/todo.ts

5. ⚠️ **Security**: Implement access control checks in all CRUD operations to verify users can only access, modify, or delete their own todos. Add userId validation to prevent unauthorized access.
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 22/100 | **Coverage:** ~15%

#### Issues (13)
  - Line 118: `critical` SQL injection vulnerability in searchTodos function. User-supplied keyword is directly interpolated into SQL query using template literals, allowing attackers to execute arbitrary SQL commands.
  - Line 127: `critical` SQL injection vulnerability in searchTodosByStatus function. User input is directly concatenated into SQL query without validation or parameterization, enabling arbitrary SQL execution.
  - Line 136: `critical` SQL injection vulnerability in getTodosByUser function. userId parameter is embedded directly in SQL query using template literals, allowing SQL injection attacks.

  *...and 10 more*

#### Test Gaps (17)
  - `createTodo (lines 52-72)` (critical priority)
  - `getAllTodos (lines 77-81)` (high priority)

  *...and 15 more*

#### Refactoring Opportunities (6)
  - **simplify**: Simplify validateTodoInput by using early returns and combining validation logic
  - **extract-function**: Extract todo sanitization logic into a reusable function

  *...and 4 more*

---

*Generated at 2026-11-12T00:00:00.000Z • Duration: 199943ms*
