/*! \file polymorphic_impl_fwd.hpp
    \brief Internal polymorphism support forward declarations
    \ingroup Internal */


/* This code is heavily inspired by the boost serialization implementation by the following authors

   (C) Copyright 2002 Robert Ramey - http://www.rrsd.com .
   Use, modification and distribution is subject to the Boost Software
   License, Version 1.0. (See http://www.boost.org/LICENSE_1_0.txt)

    See http://www.boost.org for updates, documentation, and revision history.

   (C) Copyright 2006 David Abrahams - http://www.boost.org.

   See /boost/serialization/export.hpp and /boost/archive/detail/register_archive.hpp for their
   implementation.
*/

#ifndef CEREAL_DETAILS_POLYMORPHIC_IMPL_FWD_HPP_
#define CEREAL_DETAILS_POLYMORPHIC_IMPL_FWD_HPP_

namespace cereal
{
  namespace detail
  {
    //! Forward declaration, see polymorphic_impl.hpp for more information
    template <class Base, class Derived>
    struct RegisterPolymorphicCaster;

    //! Forward declaration, see polymorphic_impl.hpp for more information
    struct PolymorphicCasters;

    //! Forward declaration, see polymorphic_impl.hpp for more information
    template <class Base, class Derived>
    struct PolymorphicRelation;
  } // namespace detail
} // namespace cereal

#endif // CEREAL_DETAILS_POLYMORPHIC_IMPL_FWD_HPP_
