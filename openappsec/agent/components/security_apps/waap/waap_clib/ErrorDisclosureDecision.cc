 

#include "ErrorDisclosureDecision.h"

ErrorDisclosureDecision::ErrorDisclosureDecision(DecisionType type) : SingleDecision(type)
{}

std::string ErrorDisclosureDecision::getTypeStr() const
{
    return "Error Disclosure";
}
