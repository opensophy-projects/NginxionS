 

#ifndef __CP_TEST_BASIC_H__
#define __CP_TEST_BASIC_H__

#include "gtest/gtest.h"
#include "gmock/gmock.h"

// Before EXPECT_DEATH, call this to do all necessary preparations.
void cptestPrepareToDie();

// Path to a file in the UT directory
std::string cptestFnameInExeDir(const std::string &name);
std::string cptestFnameInSrcDir(const std::string &name);

ACTION_TEMPLATE(
    SaveVoidArgPointee,
    HAS_2_TEMPLATE_PARAMS(int, k, typename, T),
    AND_1_VALUE_PARAMS(output)
)
{
    *output = *static_cast<T *>(::testing::get<k>(args));
}

#endif // __CP_TEST_BASIC_H__
