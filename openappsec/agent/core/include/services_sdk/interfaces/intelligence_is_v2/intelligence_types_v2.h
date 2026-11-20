 

#ifndef __INTELLIGENCE_TYPES_V2_H__
#define __INTELLIGENCE_TYPES_V2_H__

#include <string>
#include <chrono>
#include <unordered_map>
#include "debug.h"

namespace Intelligence_IS_V2
{

enum class AttributeKeyType {
    MAIN,
    REGULAR,
    NONE
};

enum class Operator
{
    AND,
    OR,
    NONE
};

enum class Condition
{
    EQUALS,
    NOT_EQUALS,
    MATCH,
    STARTS_WITH,
    CONTAINS,
    IN,
    NOT_IN,
    GREATER_THAN,
    LESS_THAN,
    RANGE
};

enum class CursorState {
    START,
    IN_PROGRESS,
    DONE
};

enum class ResponseStatus
{
    DONE,
    IN_PROGRESS
};

enum class ObjectType { ASSET, ZONE, CONFIGURATION, SHORTLIVED, COUNT};

const std::string & convertConditionTypeToString(const Condition &condition_type);
const std::string & convertOperationTypeToString(const Operator &operation_type);
std::string createAttributeString(const std::string &key, AttributeKeyType type);
ResponseStatus convertStringToResponseStatus(const std::string &status);

class IntelligenceException : public std::exception
{
public:
    IntelligenceException() : message() {}
    IntelligenceException(const std::string &msg) : message(msg) {}

    const char * what() const throw() { return message.c_str(); }

private:
    std::string message;
};

} // namespace Intelligence_IS_V2

#endif // __INTELLIGENCE_TYPES_V2_H__
