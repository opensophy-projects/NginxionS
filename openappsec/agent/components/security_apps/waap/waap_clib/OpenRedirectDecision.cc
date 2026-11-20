 

#include "OpenRedirectDecision.h"

OpenRedirectDecision::OpenRedirectDecision(DecisionType type) :
    SingleDecision(type),
    m_link("")
{}

std::string OpenRedirectDecision::getTypeStr() const
{
    return "Open Redirect";
}

void OpenRedirectDecision::setLink(const std::string& link)
{
    m_link = link;
}

std::string OpenRedirectDecision::getLink() const
{
    return m_link;
}
