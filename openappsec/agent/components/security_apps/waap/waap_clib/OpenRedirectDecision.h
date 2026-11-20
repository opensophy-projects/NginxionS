 

#ifndef __OPEN_REDIRECT_DEICSION_H__
#define __OPEN_REDIRECT_DEICSION_H__

#include "SingleDecision.h"
#include "DecisionType.h"
#include <string>

class OpenRedirectDecision: public SingleDecision
{
public:
    explicit OpenRedirectDecision(DecisionType type);

    std::string getTypeStr() const override;
    void setLink(const std::string& link);
    std::string getLink() const;

private:
    std::string m_link;
};

#endif
