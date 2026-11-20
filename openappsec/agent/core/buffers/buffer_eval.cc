 

#include "buffer.h"
#include "environment/evaluator_templates.h"

using namespace EnvironmentHelper;

class ConstantBuffer : public Constant<Buffer>
{
public:
    ConstantBuffer(const std::vector<std::string> &params)
            :
        Constant<Buffer>(
            [] (const std::string &str) { return Buffer(str); },
            params
        ) {}
    static std::string getName() { return Constant<Buffer>::getName() + "Buffer"; }
};

class EqualBuffer : public Equal<Buffer>
{
public:
    EqualBuffer(const std::vector<std::string> &params) : Equal<Buffer>(params) {}
    static std::string getName() { return Equal<Buffer>::getName() + "Buffer"; }
};

void
Buffer::preload()
{
    addMatcher<ConstantBuffer>();
    addMatcher<EqualBuffer>();
}
