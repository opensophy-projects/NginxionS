 

#ifndef __HTTP_TRANSACTION_ENUM_H__
#define __HTTP_TRANSACTION_ENUM_H__

namespace HttpTransaction {

enum class Method { GET, HEAD, POST, DELETE, CONNECT, OPTIONS, TRACE, PATCH, PUT };
enum class Dir { REQUEST, RESPONSE };
enum class Verdict { ACCEPT, DROP, INJECT, REDIRECT, NONE, DEFAULT };

enum class StatusCode {
    OK = 200,
    CREATED = 201,
    NO_CONTENT = 204,
    NOT_MODIFIED = 304,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    CONFLICT = 409,
    INTERNAL_SERVER_ERROR = 500
};

}
#endif // __HTTP_TRANSACTION_ENUM_H__
