*# How to Develop

First install `bun` and `docker`.

Install dependencies:

```sh
bun install
```

Edit environment variables:

```sh
cp .env.example .env
```

Fill the blanks, and run:

```sh
docker compose up -d
bun run drizzle-kit push
bun run dev
```

App runs on the port you specified in the environment variables.

---

# API Overview

The application provides APIs for chat functionalities and a quiz system. All API routes are prefixed with `/api`.
Authentication is required for most endpoints and is handled via session cookies.

## Authentication API

Base Path: `/api/auth`

### `POST /login`

* **Description**: Authenticates a user and creates a session. The session cookie is set in the response.
* **Request Body**: `application/form`

    ```json
    {
      "username": "username",
      "password": "user's password"
    }
    ```

* **Response**:
* Success (200): `{ "success": true, "message": "Logged in"}`
* Error (401): `{ "success": false, "error": "Invalid username or password", "cause": { "form": true }}`

### `POST /signup`

* **Description**: Registers a new user and creates a session. The session cookie is set in the response.
* **Request Body**: `application/form`

    ```json
    {
      "username": "username",
      "password": "user's password",
    }
    ```

* **Response**:
* Success (200): `{ "success": true, "message": "User created" }`
* Error (500): `{ "success": false, "error": "Failed to create user"}`

### `GET /logout`

* **Description**: Logs out the user by destroying the session. The session cookie is cleared in the response.
* **Response**:
* Redirect (302): Redirects to the home page after logging out.

### `GET /user`

* **Description**: Fetches the logged-in user's information.
* **Response**:
* Success (200): `{ "success": true, "message": "User fetched", "data": { "id": "userId", "username": "username", "profile": { "createdAt": "", "updatedAt": "", "totalQuizzesTaken": 1, "highestScore": 1 } } }`
* Error (401): `{ "success": false, "error": "Unauthorized" }` (if the user is not logged in)
* Error (404): `{ "success": false, "error": "User not found" }` (if the user does not exist)

## Chat API

Base Path: `/api/chat`

All chat routes require user authentication.

### `POST /completions`

* **Description**: Submits a user's message to the LLM and receives a completion. It stores the user's message and the LLM's response in the database, creating a new chat session if necessary.
* **Request Body**: `application/form`

    ```json
    {
      "role": "user",
      "content": "Your message to the LLM"
    }
    ```

* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully generate chat completions", "data": { "role": "assistant", "content": "LLM's response" } }`
  * Error (500): `{ "success": false, "error": "An unexpected error occurred while processing your request." }` (Error details are logged server-side)
* **Notes**:
  * The user's message timestamp (`createdAt`) is recorded when the server receives the request.
  * The LLM's response timestamp and session creation timestamp are based on the LLM API response.

### `GET /history`

* **Description**: Fetches the chat history for the logged-in user. Messages from all chat sessions are returned in a flat list, sorted by when they were created.
* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully fetch chat history", "data": [{ "id": "chatSessionId", "role": "user | assistant", "content": "message content", "createdAt": "timestamp" }, ...] }`
  * Empty (200): If no history, `data` will be an empty array.
* **Notes**: This endpoint has been optimized to avoid N+1 database queries.

## Quiz API

Base Path: `/api/quiz`

All quiz routes require user authentication.

### Starting & Taking a Quiz

#### `POST /:questionSetId/start`

* **Description**: Starts a new quiz attempt for the specified question set.
* **Path Parameters**:
  * `questionSetId` (string): The ID of the question set to start.
* **Response**:
  * Success (200): `{ "success": true, "message": "Quiz started successfully", "data": { "attemptId": "newAttemptId", "totalQuestions": 5 } }`
  * Error (404): If `questionSetId` is not found or has no questions.

#### `POST /attempt/:attemptId/answer`

* **Description**: Submits an answer for a specific question in an ongoing quiz attempt.
* **Path Parameters**:
  * `attemptId` (string): The ID of the current quiz attempt.
* **Request Body**: `application/form`

    ```json
    {
      "questionId": "questionId",
      "userAnswer": "user's answer" // e.g., "true", "option_c", "text answer"
    }
    ```

* **Response**:
  * Success (200): `{ "success": true, "message": "Answer submitted successfully", "data": { "wasCorrect": true | false, "correctAnswer": "actualCorrectAnswer" } }`
  * Error (403): If the attempt is already completed or the question does not belong to the quiz set.
  * Error (404): If `attemptId` or `questionId` is not found.

#### `POST /attempt/:attemptId/complete`

* **Description**: Marks a quiz attempt as completed. Updates the user's profile with the score and increments quizzes taken.
* **Path Parameters**:
  * `attemptId` (string): The ID of the quiz attempt to complete.
* **Response**:
  * Success (200): `{ "success": true, "message": "Quiz completed successfully", "data": { "attemptId": "attemptId", "score": 3, "totalQuestions": 5, "startedAt": "timestamp", "completedAt": "timestamp" } }`
  * Error (403): If the attempt is already completed.
  * Error (404): If `attemptId` is not found.

### Fetching Quiz Information

#### `GET /sets`

* **Description**: Fetches a list of all available question sets.
* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully fetched question sets", "data": [{ "id": "setId", "name": "Set Name", "description": "Set Description", "createdAt": "timestamp" }, ...] }`

#### `GET /sets/:questionSetId`

* **Description**: Fetches details for a specific question set, including its questions. **Correct answers are NOT included** in this response.
* **Path Parameters**:
  * `questionSetId` (string): The ID of the question set.
* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully fetched question set details", "data": { "id": "setId", "name": "Set Name", ..., "questions": [{ "id": "qId", "content": "Question text?", "type": "true_false", "options": null }, ...] } }`
  * Error (404): If `questionSetId` is not found.

#### `GET /attempts/my`

* **Description**: Fetches all quiz attempts made by the logged-in user.
* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully fetched your quiz attempts", "data": [{ "attemptId": "attemptId", "questionSetId": "setId", "questionSetName": "Set Name", "score": 3, "totalQuestions": 5, "startedAt": "timestamp", "completedAt": "timestamp | null" }, ...] }`
  * Error (404): If attempts are empty.

#### `GET /attempts/:attemptId`

* **Description**: Fetches details for a specific quiz attempt made by the logged-in user. This response **includes the user's answers and the correct answers** for review.
* **Path Parameters**:
  * `attemptId` (string): The ID of the quiz attempt.
* **Response**:
  * Success (200): `{ "success": true, "message": "Successfully fetched quiz attempt details", "data": { "id": "attemptId", ..., "answers": [{ "questionId": "qId", "questionContent": "Question text?", "userAnswer": "user's answer", "isCorrect": true, "correctAnswer": "actualCorrectAnswer" }, ...] } }`
  * Error (404): If `attemptId` is not found or does not belong to the user.
