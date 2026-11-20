 

#include "CsrfDecision.h"

CsrfDecision::CsrfDecision(DecisionType type): SingleDecision(type)
{}

std::string CsrfDecision::getTypeStr() const
{
    return "CSRF Protection";
}
